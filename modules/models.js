import { PENTRA } from "./config.js";
import { attributeStep, formatAttribute, stepDie, formatCost } from "./rules.js";

const { fields } = foundry.data;

/* -------------------------------------------------------------------------- */
/*  Field helpers                                                             */
/* -------------------------------------------------------------------------- */

const int = (initial = 0, opts = {}) =>
  new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

const dieField = (initial, opts = {}) =>
  new fields.NumberField({
    required: true, nullable: false, integer: true, initial,
    choices: PENTRA.usageDice, ...opts
  });

const rankField = () => new fields.SchemaField({
  rank: int(0, { min: 0, max: PENTRA.maxAttributeRank })
});

const mapSchema = (keys, factory) =>
  new fields.SchemaField(Object.fromEntries(keys.map(k => [k, factory(k)])));

const costField = () => new fields.SchemaField({
  die: dieField(6),
  multiplier: int(1, { min: 1, max: 6 })
});

const physicalFields = (size = "normal") => ({
  size: new fields.StringField({ required: true, initial: size, choices: Object.keys(PENTRA.sizes) }),
  legal: new fields.BooleanField({ initial: true }),
  cost: costField()
});

/* -------------------------------------------------------------------------- */
/*  Actors                                                                    */
/* -------------------------------------------------------------------------- */

/** Shared schema and derivations for anything with attributes and skills. */
class PentraActorBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes: mapSchema(Object.keys(PENTRA.attributes), rankField),
      resistances: mapSchema(Object.keys(PENTRA.resistances), rankField),
      skills: mapSchema(Object.keys(PENTRA.skills), () => int(0, { min: 0, max: PENTRA.maxSkill })),
      languages: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        value: int(PENTRA.nativeLanguageRank, { min: 0, max: PENTRA.maxSkill })
      })),
      size: new fields.StringField({ required: true, initial: "medium", choices: Object.keys(PENTRA.creatureSizes) })
    };
  }

  prepareDerivedData() {
    for (const [key, attr] of Object.entries(this.attributes)) {
      Object.assign(attr, attributeStep(attr.rank), { label: PENTRA.attributes[key], formatted: formatAttribute(attr.rank) });
    }
    for (const [key, res] of Object.entries(this.resistances)) {
      Object.assign(res, attributeStep(res.rank), { label: PENTRA.resistances[key], formatted: formatAttribute(res.rank) });
    }
    this._prepareArmor();
  }

  /** Total armor rating per hit location from equipped, unbroken armor. Heavy armor doubles AR. */
  _prepareArmor() {
    const armor = { torso: 0, arms: 0, legs: 0, head: 0 };
    let evasionPenalty = 0;
    let pieces = 0;
    for (const item of this.parent.items) {
      if (item.type !== "armor" || !item.system.equipped) continue;
      pieces++;
      evasionPenalty += item.system.evasion;
      if (item.system.isBroken) continue;
      const ar = item.system.ar * (item.system.heavy ? 2 : 1);
      for (const loc of Object.keys(armor)) if (item.system.coverage[loc]) armor[loc] += ar;
    }
    // Stacking three pieces costs an extra -1 Evasion.
    if (pieces >= 3) evasionPenalty -= 1;
    this.armor = armor;
    this.armorEvasion = evasionPenalty;
  }
}

/* -------------------------------------------------------------------------- */

export class PentraCharacterModel extends PentraActorBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      biography: new fields.HTMLField(),
      health: new fields.SchemaField({ value: int(PENTRA.traits.health.base, { min: 0 }) }),
      edge: new fields.SchemaField({ value: int(PENTRA.traits.edge.base, { min: 0, max: PENTRA.maxEdge }) }),
      karma: new fields.SchemaField({
        value: int(0, { min: 0 }),
        earned: int(0, { min: 0 })
      }),
      deathDie: new fields.SchemaField({ value: dieField(PENTRA.traits.deathDie.base) }),
      resourceDie: new fields.SchemaField({ value: dieField(PENTRA.traits.resourceDie.base) }),
      drainDie: new fields.SchemaField({ value: dieField(PENTRA.traits.drainDie.base) }),
      roundsFired: int(0, { min: 0 })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    // Sum hindrance/talent modifiers per trait.
    const mods = Object.fromEntries(Object.keys(PENTRA.traits).map(k => [k, 0]));
    let talents = 0;
    for (const item of this.parent.items) {
      if (item.type === "talent") talents++;
      if (!["hindrance", "talent"].includes(item.type)) continue;
      if (item.system.trait in mods) mods[item.system.trait] += item.system.delta;
    }
    const trait = key => {
      const { type, base } = PENTRA.traits[key];
      return type === "die" ? stepDie(base, mods[key], { min: 4 }) : base + mods[key];
    };

    this.traitMods = mods;
    this.talentCount = talents;
    this.health.max = Math.max(trait("health"), 0);
    this.edge.start = Math.clamp(trait("edge"), 0, PENTRA.maxEdge);
    this.edge.max = PENTRA.maxEdge;
    this.deathDie.max = trait("deathDie");
    this.resourceDie.start = trait("resourceDie");
    this.drainDie.max = trait("drainDie");
    this.durabilityDie = { value: trait("durabilityDie") };
    this.initiativeDie = { value: trait("initiativeDie") };
    this.evasion = { base: trait("evasion") };
    this.evasion.value = Math.max(this.evasion.base + this.armorEvasion, 0);

    // Carry slots: kits and miscellaneous gear count toward the 6 normal-sized item limit.
    let slots = 0;
    for (const item of this.parent.items) {
      if (!["fieldkit", "gear"].includes(item.type)) continue;
      const qty = item.system.quantity ?? 1;
      slots += (PENTRA.sizes[item.system.size]?.slots ?? 1) * qty;
    }
    this.carry = { used: slots, max: PENTRA.carrySlots, over: slots > PENTRA.carrySlots };

    this.ancestry = this.parent.items.find(i => i.type === "ancestry") ?? null;
  }
}

/* -------------------------------------------------------------------------- */

export class PentraNPCModel extends PentraActorBase {
  static defineSchema() {
    const schema = super.defineSchema();
    // NPCs default to the rulebook's "relative competence": d10+2 attributes.
    schema.attributes = mapSchema(Object.keys(PENTRA.attributes), () => new fields.SchemaField({
      rank: int(1, { min: 0, max: PENTRA.maxAttributeRank })
    }));
    return {
      ...schema,
      notes: new fields.HTMLField(),
      health: new fields.SchemaField({
        value: int(3, { min: 0 }),
        max: int(3, { min: 0 })
      }),
      evasion: new fields.SchemaField({ base: int(9) }),
      initiativeDie: new fields.SchemaField({ value: dieField(6, { choices: [4, 6, 8, 10, 12] }) })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.evasion.value = Math.max(this.evasion.base + this.armorEvasion, 0);
  }
}

/* -------------------------------------------------------------------------- */
/*  Items                                                                     */
/* -------------------------------------------------------------------------- */

class PentraItemBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { description: new fields.HTMLField() };
  }
}

export class PentraAncestryModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      attributeBoost: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(PENTRA.attributes)] })
    };
  }
}

/** Hindrances and talents both modify a single trait by a delta (die steps for dice, points otherwise). */
class PentraTraitModifierModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      trait: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(PENTRA.traits)] }),
      delta: int(0),
      requires: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }

  get summary() {
    if (!this.trait) return "";
    const t = PENTRA.traits[this.trait];
    const sign = this.delta > 0 ? "+" : "";
    const unit = t.type === "die" ? ` ${game.i18n.localize("PENTRA.DieSteps")}` : "";
    return `${game.i18n.localize(t.label)} ${sign}${this.delta}${unit}`;
  }
}
export class PentraHindranceModel extends PentraTraitModifierModel {}
export class PentraTalentModel extends PentraTraitModifierModel {}

export class PentraArmorModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physicalFields("normal"),
      ar: int(1, { min: 0, max: 4 }),
      coverage: new fields.SchemaField({
        torso: new fields.BooleanField({ initial: true }),
        arms: new fields.BooleanField({ initial: false }),
        legs: new fields.BooleanField({ initial: false }),
        head: new fields.BooleanField({ initial: false })
      }),
      evasion: int(0, { max: 0 }),
      layerable: new fields.BooleanField({ initial: false }),
      heavy: new fields.BooleanField({ initial: false }),
      /** Current durability usage die; null until owned, then starts at the wearer's Durability Die. */
      durability: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null, choices: PENTRA.usageDice }),
      equipped: new fields.BooleanField({ initial: false })
    };
  }

  get isBroken() {
    return this.durability === 0;
  }

  get coverageCode() {
    return Object.entries(PENTRA.hitLocations).filter(([k]) => this.coverage[k]).map(([, l]) => l.code).join("");
  }

  get costLabel() {
    return formatCost(this.cost.die, this.cost.multiplier);
  }
}

export class PentraWeaponModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physicalFields("normal"),
      category: new fields.StringField({ required: true, initial: "melee", choices: Object.keys(PENTRA.weaponCategories) }),
      skill: new fields.StringField({ required: true, initial: "melee_weapons", choices: PENTRA.attackSkills }),
      wounds: int(1, { min: 0 }),
      increment: new fields.StringField({ required: true, initial: "odd", choices: Object.keys(PENTRA.increments) }),
      range: new fields.StringField({ required: true, initial: "melee", choices: Object.keys(PENTRA.rangeBands) }),
      hands: int(1, { min: 0, max: 2 }),
      heavy: new fields.BooleanField({ initial: false }),
      reloadActions: int(0, { min: 0 }),
      equipped: new fields.BooleanField({ initial: true })
    };
  }

  get damageLabel() {
    const n = this.wounds;
    const word = game.i18n.localize(n === 1 ? "PENTRA.Wound" : "PENTRA.Wounds");
    return `${n} ${word} (${game.i18n.localize(PENTRA.increments[this.increment])})${this.heavy ? " ×2" : ""}`;
  }

  get costLabel() {
    return formatCost(this.cost.die, this.cost.multiplier);
  }
}

export class PentraFieldKitModel extends PentraItemBase {
  static KIT_TYPES = ["climbing", "communication", "disguise", "environmental", "infiltration", "reloading",
    "performance", "scuba", "survival", "technical", "trauma", "other"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physicalFields("normal"),
      kitType: new fields.StringField({ required: true, initial: "other", choices: this.KIT_TYPES }),
      /** Current usage die; null until owned, then starts at the owner's Durability Die. */
      usage: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null, choices: PENTRA.usageDice }),
      quantity: int(1, { min: 0 })
    };
  }

  get costLabel() {
    return formatCost(this.cost.die, this.cost.multiplier);
  }
}

export class PentraGearModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      ...physicalFields("normal"),
      quantity: int(1, { min: 0 })
    };
  }

  get costLabel() {
    return formatCost(this.cost.die, this.cost.multiplier);
  }
}

export class PentraVehicleModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      cost: costField(),
      legal: new fields.BooleanField({ initial: true }),
      category: new fields.StringField({ required: true, initial: "land", choices: Object.keys(PENTRA.vehicleCategories) }),
      speedClass: int(2, { min: 0, max: 5 }),
      health: new fields.SchemaField({ value: int(5, { min: 0 }), max: int(5, { min: 0 }) }),
      evasion: int(8),
      armor: int(1, { min: 0, max: 4 }),
      heavyArmor: new fields.BooleanField({ initial: false }),
      durability: new fields.SchemaField({ value: dieField(6), max: dieField(6) }),
      handling: int(0, { min: -2, max: 2 }),
      mounts: int(0, { min: 0 }),
      mountNotes: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }

  get costLabel() {
    return formatCost(this.cost.die, this.cost.multiplier);
  }
}
