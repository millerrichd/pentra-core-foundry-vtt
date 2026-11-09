import { PENTRA } from "./config.js";
import { attributeStep, formatAttribute, stepDie, formatCost, WEAPON_SLOTS, VEHICLE_MODS, vehicleModStats, UNDERWATER_MODES } from "./rules.js";

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

/** A restrained character's Evasion is halved, rounded down. */
const restrained = (actor, evasion) => (actor?.statuses?.has("restrained") ? Math.floor(evasion / 2) : evasion);

/** Shared schema and derivations for anything with attributes and skills. */
class PentraActorBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes: mapSchema(Object.keys(PENTRA.attributes), rankField),
      resistances: mapSchema(Object.keys(PENTRA.resistances), rankField),
      skills: mapSchema(Object.keys(PENTRA.skills), () => int(0, { min: 0, max: PENTRA.maxSkill })),
      languages: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        value: int(0, { min: 0, max: PENTRA.maxSkill }),
        native: new fields.BooleanField({ initial: false })
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
      roundsFired: int(0, { min: 0 }),
      /** The lifestyle paid for most recently (city downtime). */
      lifestyle: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(PENTRA.lifestyles)] }),
      /** Collapse & Risk a Scar: rounds spent at 0 Health, counted each new combat round until it ends. */
      dying: new fields.SchemaField({
        active: new fields.BooleanField({ initial: false }),
        rounds: int(0, { min: 0 })
      }),
      /**
       * Downtime projects (crafting or researching an item). The GM sets each one's value; a day's work makes a
       * Research (then Crafting) check and may grow the progress die toward the target.
       */
      projects: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        value: new fields.SchemaField({
          die: int(0, { min: 0, max: 12 }),
          multiplier: int(1, { min: 1, max: 6 })
        }),
        blueprint: new fields.BooleanField({ initial: false }),
        phase: new fields.StringField({ required: true, initial: "research", choices: ["research", "crafting", "done"] }),
        progress: int(0, { min: 0, max: 14 }),
        days: int(0, { min: 0 })
      })),
      /** Character creation limits are enforced until this is complete. */
      creation: new fields.SchemaField({
        complete: new fields.BooleanField({ initial: false })
      })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    // Sum hindrance/talent modifiers per trait.
    const mods = Object.fromEntries(Object.keys(PENTRA.traits).map(k => [k, 0]));
    let talents = 0;
    for (const item of this.parent.items) {
      if (item.type === "talent") talents++;
      if (item.type === "disease" && item.system.trait in mods) mods[item.system.trait] += item.system.traitDelta;
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
    this.evasion.value = restrained(this.parent, Math.max(this.evasion.base + this.armorEvasion, 0));

    // Carry slots: field kits count toward the 6 normal-sized item limit.
    let slots = 0;
    for (const item of this.parent.items) {
      if (item.type !== "fieldkit") continue;
      const qty = item.system.quantity ?? 1;
      slots += (PENTRA.sizes[item.system.size]?.slots ?? 1) * qty;
    }
    this.carry = { used: slots, max: PENTRA.carrySlots, over: slots > PENTRA.carrySlots };

    this.ancestry = this.parent.items.find(i => i.type === "ancestry") ?? null;
    // A character is the size of their ancestry (Human: Medium); without one, the stored size (Medium) is used.
    if (this.ancestry?.system.size) this.size = this.ancestry.system.size;
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
        value: int(6, { min: 0 }),
        max: int(6, { min: 0 })
      }),
      evasion: new fields.SchemaField({ base: int(9) }),
      initiativeDie: new fields.SchemaField({ value: dieField(6, { choices: [4, 6, 8, 10, 12] }) })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.evasion.value = restrained(this.parent, Math.max(this.evasion.base + this.armorEvasion, 0));
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
      attributeBoost: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(PENTRA.attributes)] }),
      /** Characters of this ancestry are this size (it sets the size modifier on attacks). */
      size: new fields.StringField({ required: true, initial: "medium", choices: Object.keys(PENTRA.creatureSizes) })
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
      /** Burning (e.g. a flamethrower): a hit sets the target on fire. */
      burning: new fields.BooleanField({ initial: false }),
      reloadActions: int(0, { min: 0 }),
      /** Underwater: range drops a band (reduced), also -2 for swinging weapons (swing), torpedoes (full), or fire-based (none). */
      underwater: new fields.StringField({ required: true, initial: "reduced", choices: UNDERWATER_MODES }),
      /** Carry slot: primary (2 hands' worth), backup (one weapon), or stowed (owned but not carried). */
      slot: new fields.StringField({ required: true, initial: "stowed", choices: WEAPON_SLOTS })
    };
  }

  /** Older data used an `equipped` flag. */
  static migrateData(source) {
    if (("equipped" in source) && !("slot" in source)) source.slot = source.equipped ? "primary" : "stowed";
    return super.migrateData(source);
  }

  /** Carried weapons (primary or backup) can be used. */
  get equipped() {
    return this.slot !== "stowed";
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

/** Legacy vehicle item (vehicles are actors now). Kept so old worlds can be migrated. */
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

/* -------------------------------------------------------------------------- */
/*  Vehicle actor                                                             */
/* -------------------------------------------------------------------------- */

const uuidField = () => new fields.StringField({ required: true, blank: true, initial: "" });

export class PentraVehicleActorModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      cost: costField(),
      legal: new fields.BooleanField({ initial: true }),
      category: new fields.StringField({ required: true, initial: "land", choices: Object.keys(PENTRA.vehicleCategories) }),
      speedClass: int(2, { min: 0, max: 5 }),
      health: new fields.SchemaField({ value: int(10, { min: 0 }), max: int(10, { min: 0 }) }),
      evasion: new fields.SchemaField({ base: int(8) }),
      ar: int(1, { min: 0, max: 4 }),
      heavyArmor: new fields.BooleanField({ initial: false }),
      durability: new fields.SchemaField({ value: dieField(6), max: dieField(6) }),
      handling: int(0, { min: -2, max: 2 }),
      mounts: int(0, { min: 0 }),
      mountNotes: new fields.StringField({ required: true, blank: true, initial: "" }),
      size: new fields.StringField({ required: true, initial: "large", choices: Object.keys(PENTRA.creatureSizes) }),
      /** The character who owns the vehicle (bought or gifted), by UUID. */
      owner: uuidField(),
      crew: new fields.SchemaField({
        driver: uuidField(),
        passengers: new fields.ArrayField(uuidField())
      })
    };
  }

  prepareDerivedData() {
    this.skill = PENTRA.vehicleSkills[this.category] ?? "driving";

    // Stored stats are the base model; installed modifications (items) change them.
    const counts = {};
    for (const item of this.parent?.items ?? []) {
      if (item.type === "vehiclemod") counts[item.system.mod] = (counts[item.system.mod] ?? 0) + 1;
    }
    this.base = {
      speedClass: this.speedClass, ar: this.ar, heavyArmor: this.heavyArmor, durabilityMax: this.durability.max,
      evasion: this.evasion.base, handling: this.handling, healthMax: this.health.max, cost: { ...this.cost }
    };
    this.modCounts = counts;
    const stats = vehicleModStats(this.base, counts);
    this.speedClass = stats.speedClass;
    this.ar = stats.ar;
    this.heavyArmor = stats.heavyArmor;
    this.durability.max = stats.durabilityMax;
    this.handling = stats.handling;
    this.health.max = stats.healthMax;
    this.cost = stats.cost;
    this.costLabel = formatCost(stats.cost.die, stats.cost.multiplier);

    this.evasion.value = Math.max(stats.evasion, 0);
    this.isBroken = this.durability.value <= 0;
    // Vehicle armor covers the whole vehicle; broken armor gives no protection. Heavy armor doubles AR.
    const ar = this.isBroken ? 0 : this.ar * (this.heavyArmor ? 2 : 1);
    this.armor = Object.fromEntries(Object.keys(PENTRA.hitLocations).map(k => [k, ar]));
  }

  /** The driver's actor, if they still exist. */
  get driver() {
    return this.crew.driver ? (fromUuidSync(this.crew.driver) ?? null) : null;
  }

  /** Passenger actors that still exist. */
  get passengers() {
    return this.crew.passengers.map(u => fromUuidSync(u)).filter(Boolean);
  }

  /** Everyone aboard (driver first). */
  get aboard() {
    return [this.driver, ...this.passengers].filter(Boolean);
  }

  /** In vehicle combat the driver's Initiative Die sets the vehicle's (default d6). */
  get initiativeDie() {
    return { value: this.driver?.system.initiativeDie?.value ?? 6 };
  }
}

/** A vehicle modification from the rulebook; installed by dropping it on a vehicle. */
export class PentraVehicleModModel extends PentraItemBase {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      mod: new fields.StringField({ required: true, initial: "armor", choices: Object.keys(VEHICLE_MODS) }),
      /** Added after the vehicle is bought, each modification costs d6 R.D. */
      cost: costField()
    };
  }

  get costLabel() {
    return formatCost(this.cost.die, this.cost.multiplier);
  }
}

/**
 * A disease. While a character has it, it hampers one mechanic: −2 to all checks, −2 to checks with one attribute,
 * or one trait (−1 die size for dice like the Initiative Die, −2 for numbers like Evasion).
 * Resisted with Fortitude on exposure and again each time the character sleeps; a success throws it off.
 */
export class PentraDiseaseModel extends PentraItemBase {
  static EFFECTS = ["checks", "attribute", "trait"];

  /**
   * Traits a disease can hamper. Not the Resource Die (wealth isn't an illness) or the Durability Die (gear
   * upkeep know-how). The Drain Die is only offered when the world uses it (Edgeliner, Sentius).
   */
  static TRAITS = Object.keys(PENTRA.traits).filter(k => !["resourceDie", "durabilityDie"].includes(k));

  /** Older diseases may name a trait that's no longer allowed. @override */
  static migrateData(source) {
    if (source.trait && !PentraDiseaseModel.TRAITS.includes(source.trait)) source.trait = "";
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      ...super.defineSchema(),
      effect: new fields.StringField({ required: true, initial: "checks", choices: PentraDiseaseModel.EFFECTS }),
      attribute: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(PENTRA.attributes)] }),
      trait: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...PentraDiseaseModel.TRAITS] }),
      penalty: int(-2, { max: 0 }),
      dieSteps: int(-1, { max: 0 })
    };
  }

  /** The change to a trait: die steps for dice, points for numbers. */
  get traitDelta() {
    if (this.effect !== "trait" || !this.trait) return 0;
    return PENTRA.traits[this.trait]?.type === "die" ? this.dieSteps : this.penalty;
  }

  get summary() {
    const i18n = game.i18n;
    switch (this.effect) {
      case "checks": return i18n.format("PENTRA.Disease.Summary.checks", { value: this.penalty });
      case "attribute": return this.attribute
        ? i18n.format("PENTRA.Disease.Summary.attribute", { value: this.penalty, attribute: i18n.localize(PENTRA.attributes[this.attribute]) }) : "";
      case "trait": {
        if (!this.trait) return "";
        const t = PENTRA.traits[this.trait];
        const unit = t.type === "die" ? ` ${i18n.localize("PENTRA.DieSteps")}` : "";
        return `${i18n.localize(t.label)} ${this.traitDelta}${unit}`;
      }
    }
    return "";
  }
}
