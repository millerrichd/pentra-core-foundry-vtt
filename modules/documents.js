import { PENTRA } from "./config.js";
import {
  stepDie, actionsFromInitiative, formatDie, karmaCostAttribute, karmaCostSkill, karmaCostTalent,
  KARMA_BUY_OFF_HINDRANCE, formatAttribute, purchaseRange, formatCost, armorLayeringProblem,
  weaponSlotProblem, autoWeaponSlot, vehicleModProblem, moveLimits
} from "./rules.js";
import { CREATION, creationBudget, creationViolations, raisesStats } from "./creation.js";
import { purchase, lingeringDamage, diseaseCheck, syncDiseased, shiftTraitPool } from "./rolls.js";
import { actorUnderwater, breathCheck } from "./underwater.js";

/** Item types a character must buy with the Resource Die (or be gifted by the GM). */
export const PURCHASED_TYPES = ["armor", "weapon", "fieldkit"];

const SYSTEM = "pentra-core-foundry-vtt";
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/* -------------------------------------------------------------------------- */
/*  Actor                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Character values players can't edit directly; they change only through game mechanics, which pass
 * `{ pentraMechanic: true }` with their updates. The GM can always edit them.
 */
export const PROTECTED_FIELDS = [
  "health.value", "edge.value", "karma.value", "karma.earned",
  "deathDie.value", "resourceDie.value", "drainDie.value", "dying.active", "dying.rounds"
];

/** The system's own icons (assets/), used as default art for new items and vehicles. */
const ICON = name => `systems/pentra-core-foundry-vtt/assets/noun_${name}_orange@512.webp`;
const ITEM_ICONS = {
  ancestry: "ancestry", hindrance: "hindrance", talent: "talent", armor: "modern_armor", fieldkit: "field_kit",
  vehiclemod: "vehicle_modifications", disease: "disease", vehicle: "vehicle_ground"
};
const WEAPON_ICONS = { melee: "melee_weapon", ranged: "range_weapons", vehicle: "vehicle_weapon" };
const VEHICLE_ICONS = { air: "vehicle_air", land: "vehicle_ground", sea: "vehicle_water", mount: "vehicle_ground" };

export class PentraActor extends Actor {
  /** Vehicles get the system's vehicle icons. @override */
  static getDefaultArtwork(actorData) {
    if (actorData?.type !== "vehicle") return super.getDefaultArtwork(actorData);
    const img = ICON(VEHICLE_ICONS[actorData.system?.category] ?? "vehicle_ground");
    return { img, texture: { src: img } };
  }
  /** @override */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const updates = {};
    if (!foundry.utils.hasProperty(data, "prototypeToken.bar1.attribute")) {
      updates["prototypeToken.bar1.attribute"] = "health";
    }
    // A vehicle is one real machine: its tokens share the actor, so damage sticks.
    if (this.type === "vehicle") updates["prototypeToken.actorLink"] = true;
    if (this.type === "character") {
      updates["prototypeToken.actorLink"] = true;
      updates["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      if (!data.system?.languages?.length) {
        updates["system.languages"] = [{ name: loc("PENTRA.NativeLanguage"), value: PENTRA.nativeLanguageRank, native: true }];
      }
    }
    this.updateSource(updates);
  }

  /**
   * Players can mark damage on their vehicles and manage the crew, name, picture and description. Everything else
   * changes only through game mechanics: Health and Durability come back with a repair (Crafting + Technical Kit),
   * and the vehicle's stats and cost change only by installing modifications. The GM can still edit anything.
   */
  #checkVehicleRepair(changed, options, user) {
    if (options.pentraMechanic || options.pentraBypass || user.isGM) return;
    const next = foundry.utils.flattenObject(changed.system ?? {});
    const prev = foundry.utils.flattenObject(this._source.system);
    const differs = key => (key in next) && next[key] !== prev[key];
    if (differs("health.value") && next["health.value"] > prev["health.value"]
      || differs("durability.value") && next["durability.value"] > prev["durability.value"]) {
      return this.#rejectVehicle("PENTRA.Vehicle.RepairOnly");
    }
    const LOCKED = ["category", "speedClass", "handling", "cost.die", "cost.multiplier", "ar", "heavyArmor",
      "evasion.base", "health.max", "durability.max", "mounts", "legal", "owner"];
    if (LOCKED.some(differs)) return this.#rejectVehicle("PENTRA.Vehicle.ModsOnly");
  }

  #rejectVehicle(key) {
    ui.notifications.warn(fmt(key, { name: this.name }));
    this.sheet?.render();
    return false;
  }

  /**
   * Enforce character-creation limits for players, and lock stats once creation is finished
   * (after that they rise only by spending Karma). GMs are trusted and never blocked.
   * Options: `pentraBypass` skips all checks (system-internal updates); `pentraKarma` marks a Karma purchase.
   * @override
   */
  async _preUpdate(changed, options, user) {
    if ((await super._preUpdate(changed, options, user)) === false) return false;
    if (this.type === "vehicle") return this.#checkVehicleRepair(changed, options, user);
    if (this.type !== "character" || options.pentraBypass || user.isGM) return;
    const sys = changed.system;
    if (!sys) return;
    const prev = this._source.system;

    // Pools and dice that only change through game mechanics (damage, healing, purchases, Karma...).
    if (!options.pentraMechanic) {
      const touched = PROTECTED_FIELDS.filter(path => foundry.utils.hasProperty(sys, path)
        && foundry.utils.getProperty(sys, path) !== foundry.utils.getProperty(prev, path));
      if (touched.length) return this.#reject([{ key: "PENTRA.Protected.Blocked" }]);
    }

    // Projects: players can add, rename and drop them; the value, blueprint and progress belong to the GM / the dice.
    if (sys.projects && !options.pentraMechanic) {
      const before = new Map(prev.projects.map(p => [p.id, p]));
      const fresh = { value: { die: 0, multiplier: 1 }, blueprint: false, phase: "research", progress: 0, days: 0 };
      const locked = p => JSON.stringify({ value: p.value, blueprint: p.blueprint, phase: p.phase, progress: p.progress, days: p.days });
      for (const p of Object.values(sys.projects)) {
        const old = before.get(p.id);
        const expected = old ? locked(old) : locked({ ...fresh, value: { ...fresh.value } });
        const actual = locked({ ...fresh, ...p, value: { ...fresh.value, ...(p.value ?? {}) } });
        if (actual !== expected) return this.#reject([{ key: "PENTRA.Project.GMOnly" }]);
      }
    }

    // Only the GM can reopen creation; finishing it requires a legal build.
    if (sys.creation && ("complete" in sys.creation) && (sys.creation.complete !== prev.creation.complete)) {
      if (!sys.creation.complete) return this.#reject([{ key: "PENTRA.Creation.GMOnlyReopen" }]);
      const errors = creationBudget(prev, this.creationContext()).errors;
      if (errors.length) return this.#reject(errors);
    }

    if (!["attributes", "resistances", "skills", "languages"].some(k => k in sys)) return;
    const patch = { ...sys };
    if (patch.languages && !Array.isArray(patch.languages)) patch.languages = Object.values(patch.languages);
    const next = foundry.utils.mergeObject(foundry.utils.deepClone(prev), patch, { inplace: false });

    if (!prev.creation.complete) {
      const violations = creationViolations(prev, next, this.creationContext());
      if (violations.length) return this.#reject(violations);
    } else if (!options.pentraKarma && raisesStats(prev, next)) {
      return this.#reject([{ key: "PENTRA.Creation.UseKarma" }]);
    }
  }

  /** Warn about a blocked update and redraw the sheet so inputs snap back. */
  #reject(problems) {
    const text = problems.map(p => fmt(p.key, p.data ?? {})).join(" ");
    ui.notifications.warn(text);
    this.sheet?.render();
    return false;
  }

  /** Whether this character is still in character creation. */
  get inCreation() {
    return this.type === "character" && !this.system.creation?.complete;
  }

  /** Inputs to the creation budget that come from owned items. */
  creationContext() {
    const ancestry = this.items.find(i => i.type === "ancestry");
    return {
      ancestryBoost: ancestry?.system.attributeBoost || null,
      hasAncestry: !!ancestry,
      hindrances: this.items.filter(i => i.type === "hindrance").length,
      talents: this.items.filter(i => i.type === "talent").length
    };
  }

  /** Current creation spending, errors, and warnings. */
  getCreationBudget() {
    return creationBudget(this._source.system, this.creationContext());
  }

  /** Validate and lock in character creation. */
  async finishCreation() {
    const budget = this.getCreationBudget();
    const isGM = game.user.isGM;
    const errors = budget.errors.map(e => fmt(e.key, e.data ?? {}));
    const warnings = budget.warnings.map(w => fmt(w.key, w.data ?? {}));
    if (errors.length && !isGM) {
      ui.notifications.error(`${loc("PENTRA.Creation.CannotFinish")} ${errors.join(" ")}`);
      return false;
    }
    const list = items => `<ul>${items.map(i => `<li>${foundry.utils.escapeHTML(i)}</li>`).join("")}</ul>`;
    let content = `<p>${loc("PENTRA.Creation.FinishConfirm")}</p>`;
    if (errors.length) content += `<p><strong>${loc("PENTRA.Creation.GMOverride")}</strong></p>${list(errors)}`;
    if (warnings.length) content += `<p>${loc("PENTRA.Creation.Unspent")}</p>${list(warnings)}`;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Creation.Finish") }, content
    });
    if (!ok) return false;
    await this.update({ "system.creation.complete": true }, { pentraBypass: true });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${fmt("PENTRA.Creation.Finished", { name: foundry.utils.escapeHTML(this.name) })}</p>`
    });
    return true;
  }

  /** GM only: put the character back into creation mode. */
  async reopenCreation() {
    if (!game.user.isGM) return ui.notifications.warn(loc("PENTRA.Creation.GMOnlyReopen"));
    return this.update({ "system.creation.complete": false }, { pentraBypass: true });
  }

  /** @override */
  getRollData() {
    const data = { ...this.system };
    data.initiativeDie = this.system.initiativeDie?.value ?? 6;
    return data;
  }

  /** Reset Edge to its starting value at the start of a session. */
  async startSession() {
    if (this.type !== "character") return;
    if (!game.user.isGM) return ui.notifications.warn(loc("PENTRA.Edge.GMOnlyReset"));
    await this.update({ "system.edge.value": this.system.edge.start }, { pentraMechanic: true });
    ui.notifications.info(fmt("PENTRA.Edge.SessionReset", { name: this.name, edge: this.system.edge.start }));
  }

  /** Spend Karma after asking for confirmation. */
  async #spendKarma(cost, description, updates) {
    description = foundry.utils.escapeHTML(description);
    const karma = this.system.karma.value;
    if (cost > karma) {
      ui.notifications.warn(fmt("PENTRA.Karma.NotEnough", { cost, karma }));
      return false;
    }
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Karma.Spend") },
      content: `<p>${fmt("PENTRA.Karma.Confirm", { cost, description, karma })}</p>`
    });
    if (!ok) return false;
    await this.update({ "system.karma.value": karma - cost, ...updates }, { pentraKarma: true, pentraMechanic: true });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${fmt("PENTRA.Karma.Spent", { name: this.name, cost, description })}</p>`
    });
    return true;
  }

  /** Raise an attribute or resistance one rank with Karma. */
  async improveRank(group, key) {
    const rank = this.system[group][key].rank;
    const cost = karmaCostAttribute(rank);
    if (cost === null) return ui.notifications.warn(loc("PENTRA.Karma.AtMax"));
    const label = loc(PENTRA[group][key]);
    return this.#spendKarma(cost, `${label} ${formatAttribute(rank)} → ${formatAttribute(rank + 1)}`,
      { [`system.${group}.${key}.rank`]: rank + 1 });
  }

  /** Raise a skill one rank with Karma. Learning a brand new skill (0 → 1) requires a Research check or a teacher. */
  async improveSkill(key) {
    const value = this.system.skills[key];
    const cost = karmaCostSkill(value);
    if (cost === null) return ui.notifications.warn(loc("PENTRA.Karma.AtMax"));
    let label = `${loc(PENTRA.skills[key].label)} ${value} → ${value + 1}`;
    if (value === 0) label += ` (${loc("PENTRA.Karma.LearnNote")})`;
    return this.#spendKarma(cost, label, { [`system.skills.${key}`]: value + 1 });
  }

  async improveLanguage(index) {
    const languages = foundry.utils.deepClone(this.system._source.languages);
    const lang = languages[index];
    if (!lang) return;
    const cost = karmaCostSkill(lang.value);
    if (cost === null) return ui.notifications.warn(loc("PENTRA.Karma.AtMax"));
    lang.value += 1;
    return this.#spendKarma(cost, `${lang.name} ${lang.value - 1} → ${lang.value}`, { "system.languages": languages });
  }

  /** Cost to learn the next talent. */
  get nextTalentCost() {
    return karmaCostTalent(this.system.talentCount ?? 0);
  }

  /** Buy off a hindrance for 25 Karma, deleting it (and reversing its trait change). */
  async buyOffHindrance(item) {
    const karma = this.system.karma.value;
    if (KARMA_BUY_OFF_HINDRANCE > karma) {
      return ui.notifications.warn(fmt("PENTRA.Karma.NotEnough", { cost: KARMA_BUY_OFF_HINDRANCE, karma }));
    }
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Karma.Spend") },
      content: `<p>${fmt("PENTRA.Karma.Confirm", { cost: KARMA_BUY_OFF_HINDRANCE, description: fmt("PENTRA.Karma.BuyOff", { name: foundry.utils.escapeHTML(item.name) }), karma })}</p>`
    });
    if (!ok) return;
    await this.update({ "system.karma.value": karma - KARMA_BUY_OFF_HINDRANCE }, { pentraMechanic: true });
    await item.delete({ pentraKarma: true });
  }

  /** Refill every field kit to the character's Durability Die. */
  async refreshKits() {
    const die = this.system.durabilityDie?.value ?? 8;
    const updates = this.items.filter(i => i.type === "fieldkit").map(i => ({ _id: i.id, "system.usage": die }));
    await this.updateEmbeddedDocuments("Item", updates);
    ui.notifications.info(fmt("PENTRA.Kit.Refreshed", { die: formatDie(die) }));
  }

  /** Award Karma: adds to both current and lifetime-earned Karma, and announces it. */
  async awardKarma(amount, reason = "", { chat = true } = {}) {
    amount = Math.trunc(Number(amount) || 0);
    if (amount <= 0) return;
    await this.update({
      "system.karma.value": this.system.karma.value + amount,
      "system.karma.earned": this.system.karma.earned + amount
    }, { pentraMechanic: true });
    if (!chat) return;
    const why = reason ? ` (${foundry.utils.escapeHTML(reason)})` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p><i class="fa-solid fa-star"></i> ${fmt("PENTRA.Karma.Awarded", { name: foundry.utils.escapeHTML(this.name), amount })}${why}</p>`
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Item                                                                      */
/* -------------------------------------------------------------------------- */

export class PentraItem extends Item {
  /** Item types that can no longer be created (kept only so old data can be migrated). */
  static LEGACY_TYPES = ["vehicle"];

  /** New items get the system's icon for their type. @override */
  static getDefaultArtwork(itemData) {
    const name = itemData?.type === "weapon" ? WEAPON_ICONS[itemData.system?.category ?? "melee"] : ITEM_ICONS[itemData?.type];
    return name ? { img: ICON(name) } : super.getDefaultArtwork(itemData);
  }

  /** Hide legacy types from the "Create Item" dialog. @override */
  static async createDialog(data = {}, createOptions = {}, options = {}, renderOptions = {}) {
    options.types ??= this.TYPES.filter(t => !this.LEGACY_TYPES.includes(t) && t !== CONST.BASE_DOCUMENT_TYPE);
    return super.createDialog(data, createOptions, options, renderOptions);
  }

  /** @override */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const actor = this.parent;
    if (!(actor instanceof Actor)) return;
    // Vehicles are actors with their own sheet now; the old vehicle item type only exists for migration.
    if (this.type === "vehicle" && !options.pentraBypass) {
      ui.notifications.warn(loc("PENTRA.Vehicle.NowActors"));
      return false;
    }
    if (this.type === "vehiclemod") return this.#installMod(actor, options, user);
    // Diseases are given by the GM (exposure); players can't add them to themselves.
    if (this.type === "disease") {
      if (!user.isGM && !options.pentraBypass) {
        ui.notifications.warn(loc("PENTRA.Disease.GMOnly"));
        return false;
      }
      return;
    }
    const die = actor.system.durabilityDie?.value ?? 8;
    // Armor durability and kit usage dice start at the owner's Durability Die.
    if (this.type === "armor" && this.system.durability === null) this.updateSource({ "system.durability": die });
    if (this.type === "fieldkit" && this.system.usage === null) this.updateSource({ "system.usage": die });
    // Armor that arrives already worn but can't be layered with what's on arrives unworn instead.
    if (this.type === "armor" && this.system.equipped && this.#layeringProblem(actor)) {
      this.updateSource({ "system.equipped": false });
    }
    // Only one ancestry per character.
    if (this.type === "ancestry" && actor.items.some(i => i.type === "ancestry")) {
      ui.notifications.warn(loc("PENTRA.Ancestry.OnlyOne"));
      return false;
    }
    if (actor.type !== "character") return;
    if (PURCHASED_TYPES.includes(this.type)) {
      if (!options.pentraBypass && (await this.#acquire(actor, user)) === false) return false;
      if (this.type === "weapon") this.#assignWeaponSlot(actor);
      return;
    }
    if (options.pentraBypass) return;
    return this.#checkCharacterRules(actor, user);
  }

  /**
   * The +2 Health and +1 Durability Die modifications also raise the current values when installed. When one is
   * removed (GM only), the current values are kept within the new maximums.
   */
  #applyVehicleMod(vehicle, direction) {
    // Recompute the maximums; on removal this item may still be counted, so take its effect off by hand.
    vehicle.reset();
    const stillCounted = direction < 0 && vehicle.items.has(this.id);
    const { health, durability } = vehicle.system;
    const update = {};
    if (this.system.mod === "health") {
      const max = health.max - (stillCounted ? 2 : 0);
      update["system.health.value"] = Math.clamp(health.value + 2 * direction, 0, max);
    }
    if (this.system.mod === "durability") {
      const max = stillCounted ? stepDie(durability.max, -1, { min: 4 }) : durability.max;
      update["system.durability.value"] = direction > 0
        ? Math.min(stepDie(durability.value, 1), max)
        : Math.min(durability.value, max);
    }
    if (!foundry.utils.isEmpty(update)) return vehicle.update(update, { pentraMechanic: true });
  }

  /**
   * Install a modification on a vehicle: it must be within the rulebook's limits, and once the vehicle has an
   * owner, each modification is bought for d6 R.D. with the owner's Resource Die (or gifted by the GM).
   */
  async #installMod(vehicle, options, user) {
    if (vehicle.type !== "vehicle") {
      ui.notifications.warn(loc("PENTRA.VehicleMod.OnVehicle"));
      return false;
    }
    const problem = vehicleModProblem(vehicle.system.base, vehicle.system.modCounts, this.system.mod);
    if (problem) {
      ui.notifications.warn(`${vehicle.name}: ${fmt(problem.key, { name: this.name, ...(problem.data ?? {}) })}`);
      return false;
    }
    if (options.pentraBypass) return;
    const owner = vehicle.system.owner ? fromUuidSync(vehicle.system.owner) : null;
    if (!owner) {
      if (user.isGM) return;
      ui.notifications.warn(loc("PENTRA.VehicleMod.NeedOwner"));
      return false;
    }
    if (!owner.isOwner) {
      ui.notifications.warn(fmt("PENTRA.Vehicle.NotYourVehicle", { name: vehicle.name }));
      return false;
    }
    return acquireGear(owner, { name: `${this.name} (${vehicle.name})`, cost: this.system.cost }, user);
  }

  /** Gear only reaches a character by being bought with the Resource Die, or gifted by the GM. */
  #acquire(actor, user) {
    return acquireGear(actor, { name: this.name, cost: this.system.cost }, user);
  }

  /**
   * Creation and advancement rules for ancestries, hindrances, and talents on characters.
   * Players are blocked; GMs are warned but allowed through.
   * @returns {Promise<boolean|void>} false to cancel creation
   */
  async #checkCharacterRules(actor, user) {
    const inCreation = actor.inCreation;
    const owned = type => actor.items.filter(i => i.type === type);
    const problem = (key, data = {}) => {
      const text = fmt(key, data);
      if (user.isGM) {
        ui.notifications.warn(`${text} ${loc("PENTRA.Creation.GMAllowed")}`);
        return undefined;
      }
      ui.notifications.warn(text);
      return false;
    };

    if (this.type === "ancestry" && !inCreation) return problem("PENTRA.Creation.AncestryLocked");

    // Prerequisites (e.g. Very Rich requires Rich). Hard rule, GM included.
    if (["hindrance", "talent"].includes(this.type)) {
      const requires = this.system.requires?.trim();
      const has = name => actor.items.some(i => ["hindrance", "talent"].includes(i.type)
        && i.name.toLowerCase() === name.toLowerCase());
      if (requires && !has(requires)) {
        ui.notifications.warn(fmt("PENTRA.Creation.Requires", { name: this.name, requires }));
        return false;
      }
    }

    // A hindrance may not cancel out a talent already taken (e.g. Unlucky with Lucky). Hard rule, GM included.
    if (this.type === "hindrance" && this.system.trait) {
      const cancelled = owned("talent").find(t => t.system.trait === this.system.trait
        && Math.sign(t.system.delta) === -Math.sign(this.system.delta));
      if (cancelled) {
        ui.notifications.warn(fmt("PENTRA.Creation.CancelsTalent", { name: this.name, talent: cancelled.name }));
        return false;
      }
    }

    if (this.type === "hindrance" && inCreation) {
      const max = CREATION.maxHindrances;
      if (owned("hindrance").length >= max) return problem("PENTRA.Creation.Error.Hindrances", { max });
    }

    if (this.type !== "talent") return;
    const talents = owned("talent");
    const hindrances = owned("hindrance");

    // A talent may not cancel out a hindrance (same trait, opposite direction).
    const cancels = hindrances.find(h => h.system.trait && h.system.trait === this.system.trait
      && Math.sign(h.system.delta) === -Math.sign(this.system.delta));
    if (cancels) {
      // A hard rule, not a budget: it applies to the GM too.
      ui.notifications.warn(fmt("PENTRA.Creation.Cancels", { name: this.name, hindrance: cancels.name }));
      return false;
    }

    if (inCreation) {
      const max = Math.min(hindrances.length, CREATION.maxHindrances);
      if (talents.length >= max) return problem("PENTRA.Creation.Error.Talents", { used: talents.length, max });
      return;
    }

    // After creation a player learns talents with Karma: 10 x talents owned + 10.
    if (user.isGM) return;
    const cost = karmaCostTalent(talents.length);
    const karma = actor.system.karma.value;
    if (cost > karma) return problem("PENTRA.Karma.NotEnough", { cost, karma });
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Karma.Spend") },
      content: `<p>${fmt("PENTRA.Karma.Confirm", { cost, description: foundry.utils.escapeHTML(this.name), karma })}</p>`
    });
    if (!ok) return false;
    await actor.update({ "system.karma.value": karma - cost }, { pentraMechanic: true });
  }

  /**
   * Armor layering: one outer piece at a time, "can be worn under" pieces beneath it, max three pieces.
   * Checked when armor is put on, or when worn armor stops being layerable.
   * @override
   */
  async _preUpdate(changed, options, user) {
    if ((await super._preUpdate(changed, options, user)) === false) return false;
    if (!(this.parent instanceof Actor)) return;
    if (this.type === "weapon") return this.#checkWeaponSlot(changed);
    if (this.type !== "armor") return;
    const next = changed.system ?? {};
    const willWear = next.equipped ?? this.system.equipped;
    const willLayer = next.layerable ?? this.system.layerable;
    const puttingOn = willWear && !this.system.equipped;
    const losingLayer = willWear && this.system.layerable && !willLayer;
    if (!puttingOn && !losingLayer) return;
    const problem = this.#layeringProblem(this.parent, willLayer);
    if (!problem) return;
    ui.notifications.warn(fmt(problem.key, problem.data));
    this.sheet?.render();
    return false;
  }

  /**
   * Carry limits for characters: moving a weapon into a slot (or changing its hands while carried) must fit.
   * A physical limit, so it applies to the GM too.
   */
  #checkWeaponSlot(changed) {
    if (this.parent.type !== "character") return;
    const next = changed.system ?? {};
    if (!("slot" in next) && !("hands" in next)) return;
    const slot = next.slot ?? this.system.slot;
    const hands = next.hands ?? this.system.hands;
    if (slot === "stowed" || (slot === this.system.slot && hands <= this.system.hands)) return;
    const problem = weaponSlotProblem(this.#otherWeapons(this.parent), { name: this.name, hands }, slot);
    if (!problem) return;
    ui.notifications.warn(fmt(problem.key, problem.data));
    this.parent.sheet?.render();
    this.sheet?.render();
    return false;
  }

  /** The character's other weapons, as plain carry data. */
  #otherWeapons(actor) {
    return actor.items
      .filter(i => i.type === "weapon" && i.id !== this.id)
      .map(i => ({ name: i.name, hands: i.system.hands, slot: i.system.slot }));
  }

  /** Put a newly acquired weapon in its requested slot if it fits, otherwise the best free one. */
  #assignWeaponSlot(actor) {
    const others = this.#otherWeapons(actor);
    const weapon = { name: this.name, hands: this.system.hands };
    if (!weaponSlotProblem(others, weapon, this.system.slot) && this.system.slot !== "stowed") return;
    const slot = autoWeaponSlot(others, weapon);
    this.updateSource({ "system.slot": slot });
    ui.notifications.info(fmt("PENTRA.Weapon.Slotted", { name: this.name, slot: loc(`PENTRA.Weapon.Slot.${slot}`) }));
  }

  /** The layering problem with wearing this armor on an actor, if any. */
  #layeringProblem(actor, layerable = this.system.layerable) {
    const worn = actor.items
      .filter(i => i.type === "armor" && i.system.equipped && i.id !== this.id)
      .map(i => ({ name: i.name, layerable: i.system.layerable }));
    return armorLayeringProblem(worn, { name: this.name, layerable });
  }

  /**
   * After creation, players can't swap ancestries or drop hindrances (those are bought off with Karma).
   * @override
   */
  async _preDelete(options, user) {
    if ((await super._preDelete(options, user)) === false) return false;
    const actor = this.parent;
    // A disease goes away by beating it (Fortitude on sleep) or by the GM.
    if (this.type === "disease" && actor instanceof Actor && !user.isGM && !options.pentraBypass && !options.pentraMechanic) {
      ui.notifications.warn(loc("PENTRA.Disease.CantRemove"));
      return false;
    }
    if (this.type === "vehiclemod" && actor instanceof Actor && !user.isGM && !options.pentraBypass) {
      ui.notifications.warn(loc("PENTRA.VehicleMod.GMRemoves"));
      return false;
    }
    if (!(actor instanceof Actor) || actor.type !== "character") return;
    if (["hindrance", "talent"].includes(this.type) && !options.pentraBypass) {
      const name = this.name.toLowerCase();
      const dependent = actor.items.find(i => i.id !== this.id && ["hindrance", "talent"].includes(i.type)
        && i.system.requires?.trim().toLowerCase() === name);
      if (dependent) {
        ui.notifications.warn(fmt("PENTRA.Creation.RequiredBy", { name: this.name, dependent: dependent.name }));
        return false;
      }
    }
    if (user.isGM) return;
    if (actor.inCreation || options.pentraKarma || options.pentraBypass) return;
    if (this.type === "ancestry") {
      ui.notifications.warn(loc("PENTRA.Creation.AncestryLocked"));
      return false;
    }
    if (this.type === "hindrance") {
      ui.notifications.warn(loc("PENTRA.Creation.HindranceLocked"));
      return false;
    }
  }

  /** @override */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (userId !== game.user.id) return;
    this.#applyToActor(1);
    if (this.type === "disease" && this.parent instanceof Actor) {
      // Exposure: a Fortitude check right away (skipped for a blank disease the GM is still writing up).
      if (!options.pentraBypass && this.parent.system.resistances) diseaseCheck(this.parent, this, "exposure");
      else syncDiseased(this.parent);
    }
  }

  /** @override */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    if (userId !== game.user.id) return;
    this.#applyToActor(-1);
    if (this.type === "disease" && this.parent instanceof Actor) syncDiseased(this.parent);
  }

  /**
   * Ancestries boost an attribute; hindrances and talents shift the current value of pool-style traits
   * (Health, Edge, Death/Resource/Drain Die) so a freshly built character starts at the right values.
   * Maximums are derived, so they don't need to be written.
   * @param {1|-1} direction  1 when added, -1 when removed
   */
  #applyToActor(direction) {
    const actor = this.parent;
    if (this.type === "vehiclemod" && actor?.type === "vehicle") return this.#applyVehicleMod(actor, direction);
    if (!(actor instanceof Actor) || actor.type !== "character") return;
    const sys = actor.system;

    if (this.type === "ancestry" && this.system.attributeBoost) {
      const key = this.system.attributeBoost;
      const rank = Math.clamp(sys.attributes[key].rank + direction, 0, PENTRA.maxAttributeRank);
      return actor.update({ [`system.attributes.${key}.rank`]: rank }, { pentraBypass: true });
    }

    // A cured disease gives back what it took when it took hold (only if it did).
    if (this.type === "disease") {
      if (direction < 0 && this.getFlag(SYSTEM, "applied")) return shiftTraitPool(actor, this.system.trait, -this.system.traitDelta);
      return;
    }

    if (!["hindrance", "talent"].includes(this.type) || !this.system.trait) return;
    return shiftTraitPool(actor, this.system.trait, this.system.delta * direction);
  }
}

/**
 * Gear only reaches a character by being bought with the Resource Die, or gifted by the GM.
 * Shows a prompt to the user adding it; returns false to cancel.
 * @param {Actor} actor                       The character receiving it
 * @param {{name: string, cost: object}} gear
 * @param {User} user                         The user adding it
 */
export async function acquireGear(actor, gear, user) {
  const { die: costDie, multiplier } = gear.cost ?? {};
  const resourceDie = actor.system.resourceDie.value;
  const range = purchaseRange({ costDie, multiplier, resourceDie });
  const cost = formatCost(costDie, multiplier);
  const name = foundry.utils.escapeHTML(gear.name);
  const actorName = foundry.utils.escapeHTML(actor.name);

  let outcome;
  if (range === null) outcome = fmt("PENTRA.Acquire.TooExpensive", { cost, die: formatDie(resourceDie) });
  else if (range === 0) outcome = loc("PENTRA.Acquire.Free");
  else outcome = fmt("PENTRA.Acquire.Odds", { die: formatDie(resourceDie), range, next: formatDie(stepDie(resourceDie, -1)) });

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: fmt("PENTRA.Acquire.Title", { name: gear.name }), icon: "fa-solid fa-cart-shopping" },
    position: { width: 420 },
    content: `<div class="pentra acquire-dialog">
      <p>${fmt("PENTRA.Acquire.Prompt", { name, actor: actorName })}</p>
      <p><strong>${loc("PENTRA.Cost")}:</strong> ${cost} &nbsp;·&nbsp; <strong>${loc("PENTRA.Trait.resourceDie")}:</strong> ${formatDie(resourceDie)}</p>
      <p class="hint">${outcome}</p>
      ${user.isGM ? "" : `<p class="hint">${loc("PENTRA.Acquire.GiftHint")}</p>`}
    </div>`,
    rejectClose: false,
    buttons: [
      { action: "buy", label: "PENTRA.Acquire.Buy", icon: "fa-solid fa-dice", default: range !== null, disabled: range === null },
      ...(user.isGM ? [{ action: "gift", label: "PENTRA.Acquire.Gift", icon: "fa-solid fa-gift" }] : []),
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", default: range === null }
    ]
  });

  if (choice === "buy") {
    return (await purchase(actor, { label: gear.name, costDie, multiplier })) ? undefined : false;
  }
  if (choice === "gift") {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><i class="fa-solid fa-gift"></i> ${fmt("PENTRA.Acquire.Gifted", { name, actor: actorName })}</p>`
    });
    return;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Token movement                                                            */
/* -------------------------------------------------------------------------- */

export class PentraTokenDocument extends TokenDocument {
  /**
   * In a running combat, a character can move at most Far (Close with a Leg Wound) in a round, counting what
   * they've already moved this turn (Foundry clears that history at the start of each turn). A restrained
   * character can't move on their own at any time. Moves past the limit are stopped; the GM can always move tokens.
   * Going past a normal move (Close; Very Close with a Leg Wound) is a run: Running (−2) switches on by itself.
   * @override
   */
  async _preUpdateMovement(movement, operation) {
    if ((await super._preUpdateMovement(movement, operation)) === false) return false;
    const actor = this.actor;
    if (!actor || actor.type === "vehicle") return;

    // Restrained: no moving under their own power, in or out of combat. (The grappler drags them: a GM move.)
    if (!game.user.isGM && actor.statuses.has("restrained")) {
      ui.notifications.warn(fmt("PENTRA.Move.Restrained", { name: this.name }));
      return false;
    }

    if (!this.combatant?.combat?.started) return;
    // Swimming underwater, like a Leg Wound, drops the limits to Very Close / Close.
    const limits = moveLimits(actor.statuses.has("legWound"), actorUnderwater(actor));
    const total = movement.history.distance + movement.passed.distance + movement.pending.distance;

    if (!game.user.isGM) {
      if (total > limits.run + 0.01) {
        ui.notifications.warn(fmt("PENTRA.Move.Blocked", {
          name: this.name, distance: Math.round(total * 10) / 10, limit: limits.run,
          moved: Math.round(movement.history.distance * 10) / 10
        }));
        return false;
      }
    }

    if (total > limits.walk + 0.01 && !actor.statuses.has("running") && actor.isOwner) {
      await actor.toggleStatusEffect("running", { active: true });
      ui.notifications.info(fmt("PENTRA.Move.NowRunning", { name: this.name }));
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Combat                                                                    */
/* -------------------------------------------------------------------------- */

export class PentraCombatant extends Combatant {
  /** The initiative die this combatant is currently rolling (it shifts during combat). */
  get initiativeDie() {
    return this.getFlag(SYSTEM, "initiativeDie") ?? this.actor?.system.initiativeDie?.value ?? 6;
  }

  /** Actions available this round: one per 6 points of initiative. */
  get actions() {
    return Number.isNumeric(this.initiative) ? actionsFromInitiative(this.initiative) : null;
  }

  /** @override */
  _getInitiativeFormula() {
    return `1d${this.initiativeDie}`;
  }
}

export class PentraCombat extends Combat {
  /**
   * Roll initiative with each combatant's current initiative die. A natural 1 drops the die a size,
   * a natural max raises it, for the rest of this combat.
   * @override
   */
  async rollInitiative(ids, { formula = null, updateTurn = true, messageMode, messageOptions = {} } = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    const updates = [];
    const messages = [];
    for (const [i, id] of ids.entries()) {
      const combatant = this.combatants.get(id);
      if (!combatant?.isOwner) continue;
      const die = combatant.initiativeDie;
      const roll = combatant.getInitiativeRoll(formula);
      await roll.evaluate();

      const natural = roll.dice[0]?.total ?? roll.total;
      let next = die;
      let shift = "";
      if (natural === 1 && die > 4) {
        next = stepDie(die, -1, { min: 4 });
        shift = fmt("PENTRA.Initiative.Crash", { from: formatDie(die), to: formatDie(next) });
      } else if (natural === die && die < 12) {
        next = stepDie(die, 1, { min: 4 });
        shift = fmt("PENTRA.Initiative.Spike", { from: formatDie(die), to: formatDie(next) });
      }
      updates.push({ _id: id, initiative: roll.total, [`flags.${SYSTEM}.initiativeDie`]: next });

      const actions = actionsFromInitiative(roll.total);
      const flavor = [
        fmt("PENTRA.Initiative.Flavor", { name: foundry.utils.escapeHTML(combatant.name), actions }),
        shift
      ].filter(Boolean).join("<br>");
      const chatData = await roll.toMessage(foundry.utils.mergeObject({
        speaker: ChatMessage.getSpeaker({ actor: combatant.actor, token: combatant.token, alias: combatant.name }),
        flavor,
        flags: { "core.initiativeRoll": true }
      }, messageOptions), { messageMode: messageMode ?? (combatant.hidden ? "gm" : undefined), create: false });
      if (i > 0) chatData.sound = null;
      messages.push(chatData);
    }
    if (!updates.length) return this;

    const updateOptions = { turnEvents: false };
    if (!updateTurn) updateOptions.combatTurn = this.turn;
    await this.updateEmbeddedDocuments("Combatant", updates, updateOptions);
    await ChatMessage.implementation.create(messages);
    return this;
  }

  /**
   * A dying character counts another round down at the end of each of their turns.
   * Foundry calls this once, on the active GM's client, for every turn that ends (including skipped ones).
   * @override
   */
  async _onEndTurn(combatant, context) {
    await super._onEndTurn(combatant, context);
    const actor = combatant.actor;
    if (!actor) return;

    // Shaken clears at the end of the character's next turn. If it was applied during this very turn
    // (e.g. an end-of-turn effect), it lasts until the end of their following turn.
    if (actor.statuses.has("shaken")) {
      const at = actor.getFlag(SYSTEM, "shakenAt");
      const sameTurn = at && (at.combat === this.id) && (at.round === context.round) && (at.turn === context.turn);
      if (!sameTurn) await clearShaken(actor);
    }

    // Running (moving past Close) only lasts the round it was declared in.
    if (actor.statuses.has("running")) await actor.toggleStatusEffect("running", { active: false });

    if (actor.system.dying?.active) {
      await actor.update({ "system.dying.rounds": actor.system.dying.rounds + 1 }, { pentraMechanic: true });
    }

    // End-of-turn effects: burning and poison. Any Shaken they cause lasts until the end of the next turn.
    await lingeringDamage(actor);

    // Underwater: holding their breath, then drowning.
    await breathCheck(actor, this);
  }

  /** Ties go to player characters before NPCs. @override */
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    return (ib - ia) || (Number(a.isNPC) - Number(b.isNPC)) || (a.id > b.id ? 1 : -1);
  }
}

/**
 * Everyone re-rolls initiative at the start of every round. Run once, on the active GM's client.
 */
export async function onUpdateCombat(combat, changed, options) {
  if (!("round" in changed) || changed.round <= 1) return;
  if (!game.users.activeGM?.isSelf) return;
  // Only when advancing (not rewinding).
  if (options.direction !== 1) return;

  if (!game.settings.get(SYSTEM, "rerollInitiative")) return;
  const ids = combat.combatants.filter(c => !c.isDefeated).map(c => c.id);
  // Keep the turn pointer at 0 so the new highest roll acts first.
  combat.rollInitiative(ids, { updateTurn: false });
}

/** Remove Shaken and its timing marker. */
async function clearShaken(actor) {
  await actor.toggleStatusEffect("shaken", { active: false });
  if (actor.getFlag(SYSTEM, "shakenAt")) await actor.unsetFlag(SYSTEM, "shakenAt");
}

/** Characters in a combat whose dying count is running (each actor once). */
function dyingActors(combat) {
  const actors = new Set(combat.combatants.map(c => c.actor).filter(a => a?.system.dying?.active));
  return [...actors];
}

/**
 * When combat ends: Shaken wears off for every combatant, and any running dying count stops and the
 * Death Die is rolled.
 */
export async function onDeleteCombat(combat) {
  if (!game.users.activeGM?.isSelf) return;
  const actors = new Set(combat.combatants.map(c => c.actor).filter(Boolean));
  for (const actor of actors) {
    if (actor.statuses.has("shaken")) await clearShaken(actor);
  }
  const { resolveDying } = await import("./rolls.js");
  for (const actor of dyingActors(combat)) {
    await resolveDying(actor, game.i18n.localize("PENTRA.Dying.ByCombatEnd"));
  }
}

/** Show the number of actions and the current initiative die in the combat tracker. */
export function onRenderCombatTracker(app, html) {
  const combat = app.viewed;
  if (!combat) return;
  for (const li of html.querySelectorAll("li.combatant[data-combatant-id]")) {
    const c = combat.combatants.get(li.dataset.combatantId);
    if (!c) continue;
    const name = li.querySelector(".token-name .name");
    if (!name || li.querySelector(".pentra-init")) continue;
    const tag = document.createElement("span");
    tag.className = "pentra-init";
    const actions = c.actions;
    const dying = c.actor?.system.dying;
    tag.textContent = `${formatDie(c.initiativeDie)}${actions ? ` · ${fmt("PENTRA.Initiative.Actions", { n: actions })}` : ""}`
      + (dying?.active ? ` · ${fmt("PENTRA.Dying.Tracker", { n: dying.rounds })}` : "");
    name.after(tag);
  }
}
