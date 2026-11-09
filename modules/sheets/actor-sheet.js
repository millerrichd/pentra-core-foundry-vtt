import { PENTRA } from "../config.js";
import { formatDie, formatAttribute, karmaCostAttribute, karmaCostSkill, karmaCostTalent, reloadRange, projectTarget } from "../rules.js";
import * as Rolls from "../rolls.js";
import { CREATION, nativeIndex } from "../creation.js";
import { PURCHASED_TYPES } from "../documents.js";
import { KARMA_SESSION, KARMA_ARCS } from "../apps/party.js";
import * as Vehicles from "../vehicles.js";
import * as Underwater from "../underwater.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;
const SYSTEM = "pentra-core-foundry-vtt";
const TEMPLATES = `systems/${SYSTEM}/templates/actor`;
const loc = key => game.i18n.localize(key);

/** Die choices for selects. */
const dieOptions = (dice, { zero = false } = {}) =>
  Object.fromEntries(dice.filter(d => zero || d > 0).map(d => [d, formatDie(d)]));
const rankOptions = () =>
  Object.fromEntries(PENTRA.attributeRanks.map((_, i) => [i, formatAttribute(i)]));

/**
 * Shared base for Pentra actor sheets.
 */
class PentraActorSheetBase extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pentra", "sheet", "actor"],
    form: { submitOnChange: true },
    window: { resizable: true },
    actions: {
      roll: PentraActorSheetBase.#onRoll,
      attack: PentraActorSheetBase.#onAttack,
      itemCreate: PentraActorSheetBase.#onItemCreate,
      itemEdit: PentraActorSheetBase.#onItemEdit,
      itemDelete: PentraActorSheetBase.#onItemDelete,
      itemToggle: PentraActorSheetBase.#onItemToggle,
      itemUsage: PentraActorSheetBase.#onItemUsage,
      itemSell: PentraActorSheetBase.#onItemSell,
      itemPost: PentraActorSheetBase.#onItemPost,
      repairArmor: PentraActorSheetBase.#onRepairArmor,
      salvageArmor: PentraActorSheetBase.#onSalvageArmor,
      openVehicle: PentraActorSheetBase.#onOpenVehicle,
      diseaseCheck: PentraActorSheetBase.#onDiseaseCheck,
      sellVehicle: PentraActorSheetBase.#onSellVehicle,
      toggleEdit: PentraActorSheetBase.#onToggleEdit,
      stepSkill: PentraActorSheetBase.#onStepSkill
    }
  };

  /** Whether the sheet shows every skill (edit mode) or only trained ones. */
  _editMode = false;

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    Object.assign(context, {
      actor,
      system: sys,
      source: sys._source,
      config: PENTRA,
      editable: this.isEditable,
      editMode: this._editMode,
      isGM: game.user.isGM,
      isCharacter: actor.type === "character",
      rankOptions: rankOptions(),
      dice: { usage: { 0: loc("PENTRA.Depleted"), ...dieOptions(PENTRA.usageDice) } },
      sizeOptions: Object.fromEntries(Object.entries(PENTRA.creatureSizes).map(([k, v]) => [k, v]))
    });

    context.attributes = Object.entries(sys.attributes).map(([key, a]) => ({
      key, ...a, label: loc(PENTRA.attributes[key]),
      karmaCost: karmaCostAttribute(a.rank),
      skills: this._prepareSkills(key)
    }));
    context.resistances = Object.entries(sys.resistances).map(([key, r]) => ({
      key, ...r, label: loc(PENTRA.resistances[key]), karmaCost: karmaCostAttribute(r.rank)
    }));
    const native = nativeIndex(sys.languages);
    context.languages = sys.languages.map((l, index) => ({ ...l, index, isNative: index === native, karmaCost: karmaCostSkill(l.value) }));
    context.armorByLocation = Object.entries(PENTRA.hitLocations).map(([key, l]) => ({
      key, label: loc(l.label), value: sys.armor?.[key] ?? 0
    }));
    context.items = this._prepareItems();
    context.weaponSlots = { primary: "PENTRA.Weapon.Slot.primary", backup: "PENTRA.Weapon.Slot.backup", stowed: "PENTRA.Weapon.Slot.stowed" };
    if (actor.type === "character") {
      const weapons = context.items.weapon.map(w => w.item);
      const hands = weapons.filter(w => w.system.slot === "primary").reduce((n, w) => n + (w.system.hands || 0), 0);
      const backups = weapons.filter(w => w.system.slot === "backup").length;
      context.weaponCarry = {
        label: game.i18n.format("PENTRA.Weapon.CarrySummary", { hands, backups }),
        over: hands > 2 || backups > 1
      };
    }
    context.martialArts = PENTRA.martialArts[sys.skills.martial_arts];
    if (actor.type === "character") context.vehicles = this._prepareVehicles();
    return context;
  }

  _prepareSkills(attribute) {
    const sys = this.actor.system;
    const skills = [];
    for (const [key, s] of Object.entries(PENTRA.skills)) {
      if (s.attribute !== attribute) continue;
      const value = sys.skills[key];
      if (!this._editMode && !value && this.actor.type === "npc") continue;
      skills.push({
        key, value, label: loc(s.label), karmaCost: karmaCostSkill(value), trained: value > 0,
        canStep: this.isEditable, canRaise: this.isEditable && value < PENTRA.maxSkill, canLower: this.isEditable && value > 0
      });
    }
    return skills;
  }

  /** Vehicles this character owns, plus any they're riding in. */
  _prepareVehicles() {
    const actor = this.actor;
    const ride = Rolls.vehicleCarrying(actor);
    const list = Vehicles.vehiclesOwnedBy(actor);
    if (ride && !list.includes(ride)) list.push(ride);
    return list.map(v => {
      const role = Vehicles.crewRole(v, actor);
      return {
        uuid: v.uuid, name: v.name, img: v.img, system: v.system,
        owned: v.system.owner === actor.uuid,
        damaged: v.system.health.value < v.system.health.max,
        role: role ? loc(role === "driver" ? "PENTRA.Vehicle.Driver" : "PENTRA.Vehicle.Passenger") : "—"
      };
    });
  }

  _prepareItems() {
    const groups = { ancestry: [], hindrance: [], talent: [], armor: [], weapon: [], fieldkit: [], disease: [] };
    const items = [...this.actor.items].sort((a, b) => (a.sort || 0) - (b.sort || 0));
    for (const item of items) {
      const entry = { item, id: item.id, name: item.name, img: item.img, system: item.system };
      switch (item.type) {
        case "armor":
          entry.durability = item.system.isBroken ? loc("PENTRA.Broken") : formatDie(item.system.durability ?? 0);
          entry.coverage = item.system.coverageCode;
          entry.cost = item.system.costLabel;
          break;
        case "weapon":
          entry.damage = item.system.damageLabel;
          entry.skillLabel = loc(PENTRA.skills[item.system.skill].label);
          entry.rangeLabel = loc(PENTRA.rangeBands[item.system.range]);
          entry.cost = item.system.costLabel;
          break;
        case "fieldkit":
          entry.usage = formatDie(item.system.usage ?? 0);
          entry.cost = item.system.costLabel;
          entry.isReloading = item.system.kitType === "reloading";
          break;
        case "hindrance":
        case "talent":
        case "disease":
          entry.summary = item.system.summary;
          break;
      }
      groups[item.type]?.push(entry);
    }
    return groups;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Inline editing of embedded item fields (e.g. quantity, usage die) from the actor sheet.
    for (const input of this.element.querySelectorAll("[data-item-field]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const item = this.actor.items.get(input.closest("[data-item-id]").dataset.itemId);
        const value = input.type === "checkbox" ? input.checked : input.type === "number" || input.dataset.dtype === "Number" ? Number(input.value) : input.value;
        item?.update({ [input.dataset.itemField]: value });
      });
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Action handlers (bound to the sheet instance)                           */
  /* ------------------------------------------------------------------------ */

  _getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  static async #onRoll(event, target) {
    const { type, key } = target.dataset;
    return Rolls.rollCheck(this.actor, { type, key: type === "language" ? Number(key) : key, skipDialog: event.shiftKey });
  }

  static async #onAttack(event, target) {
    if (target.dataset.unarmed) return Rolls.rollCheck(this.actor, { type: "attack", unarmed: true, skipDialog: event.shiftKey });
    const weapon = this._getItem(target);
    if (!weapon) return;
    if (this.actor.type === "character" && weapon.system.slot === "stowed") {
      return ui.notifications.warn(game.i18n.format("PENTRA.Weapon.StowedAttack", { name: weapon.name }));
    }
    return Rolls.rollCheck(this.actor, { type: "attack", weapon, skipDialog: event.shiftKey });
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("DOCUMENT.New", { type: loc(CONFIG.Item.typeLabels[type]) });
    // A GM creating blank custom gear on the sheet is effectively a gift: skip the purchase prompt.
    // Likewise a disease made here is still being written up: no exposure check until the GM rolls one.
    const options = game.user.isGM && (PURCHASED_TYPES.includes(type) || type === "disease") ? { pentraBypass: true } : {};
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name, type }], options);
    item?.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    this._getItem(target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = this._getItem(target);
    if (!item) return;
    if (item.type === "hindrance" && this.actor.type === "character" && target.dataset.buyOff) {
      return this.actor.buyOffHindrance(item);
    }
    return item.deleteDialog();
  }

  static #onItemToggle(event, target) {
    const item = this._getItem(target);
    return item?.update({ "system.equipped": !item.system.equipped });
  }

  /** Roll a kit's usage die (with special handling for Reloading Kits after combat). */
  static async #onItemUsage(event, target) {
    const item = this._getItem(target);
    if (!item) return;
    // Using a Trauma Kit means treating wounds (Medicine check, then the kit's usage check).
    if (item.system.kitType === "trauma") return Rolls.treatWounds(this.actor);
    let range = 2;
    let note;
    if (item.system.kitType === "reloading" && this.actor.type === "character") {
      const rounds = this.actor.system.roundsFired;
      range = reloadRange(rounds);
      note = game.i18n.format("PENTRA.Kit.ReloadNote", { rounds });
      await this.actor.update({ "system.roundsFired": 0 });
    }
    return Rolls.rollUsage({
      actor: this.actor, label: item.name, die: item.system.usage, range, note,
      onReduce: next => item.update({ "system.usage": next })
    });
  }

  static async #onItemSell(event, target) {
    const item = this._getItem(target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Sell.Title") },
      content: `<p>${game.i18n.format("PENTRA.Sell.Confirm", { name: item.name })}</p>`
    });
    if (!ok) return;
    await Rolls.sell(this.actor, { label: item.name, costDie: item.system.cost.die, multiplier: item.system.cost.multiplier });
    return item.delete();
  }

  static async #onItemPost(event, target) {
    const item = this._getItem(target);
    if (!item) return;
    const description = await TextEditor.implementation.enrichHTML(item.system.description, { relativeTo: item });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pentra chat-card"><header class="card-header"><img src="${foundry.utils.escapeHTML(item.img)}" width="32" height="32" alt=""><h3>${foundry.utils.escapeHTML(item.name)}</h3></header>${description}</div>`
    });
  }

  /** Repair armor with a Crafting check (on success restore to the Durability Die). */
  /** Repair all worn armor with one Crafting check. */
  /** Repair all worn, unbroken armor to full (a 10-minute short downtime activity). */
  static #onRepairArmor() {
    return Rolls.repairWornArmor(this.actor);
  }

  /** Fix a broken piece by salvaging an identical suit. */
  static #onSalvageArmor(event, target) {
    const item = this._getItem(target);
    if (item) return Rolls.salvageArmor(this.actor, item);
  }

  /** Roll Fortitude against a disease now (e.g. a fresh exposure, or one written up on the sheet). */
  static #onDiseaseCheck(event, target) {
    const item = this._getItem(target);
    if (item) return Rolls.diseaseCheck(this.actor, item, "manual");
  }

  static #onOpenVehicle(event, target) {
    fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid)?.sheet.render(true);
  }

  static #onSellVehicle(event, target) {
    const vehicle = fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid);
    if (vehicle) return Vehicles.sellVehicle(vehicle);
  }

  /** Dropping a vehicle on a character buys it (or the GM gifts it). @override */
  async _onDropActor(event, actor) {
    if (actor?.type !== "vehicle" || this.actor.type !== "character" || !this.isEditable) return null;
    return Vehicles.acquireVehicle(this.actor, actor);
  }

  /** Raise or lower a skill by one with the +/- buttons. Limits are enforced by the actor's update guard. */
  static #onStepSkill(event, target) {
    const key = target.dataset.key;
    const delta = Number(target.dataset.delta);
    const value = Math.clamp(this.actor.system.skills[key] + delta, 0, PENTRA.maxSkill);
    if (value === this.actor.system.skills[key]) return;
    return this.actor.update({ [`system.skills.${key}`]: value });
  }

  static #onToggleEdit() {
    this._editMode = !this._editMode;
    this.render();
  }
}

/* -------------------------------------------------------------------------- */

export class PentraCharacterSheet extends PentraActorSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ["character"],
    position: { width: 760, height: 820 },
    actions: {
      improveRank: PentraCharacterSheet.#onImproveRank,
      improveSkill: PentraCharacterSheet.#onImproveSkill,
      improveLanguage: PentraCharacterSheet.#onImproveLanguage,
      addLanguage: PentraCharacterSheet.#onAddLanguage,
      removeLanguage: PentraCharacterSheet.#onRemoveLanguage,
      support: PentraCharacterSheet.#onSupport,
      resourceUsage: PentraCharacterSheet.#onResourceUsage,
      lifestyle: PentraCharacterSheet.#onLifestyle,
      refreshKits: PentraCharacterSheet.#onRefreshKits,
      blaze: PentraCharacterSheet.#onBlaze,
      rest: PentraCharacterSheet.#onRest,
      restockAmmo: PentraCharacterSheet.#onRestockAmmo,
      reward: PentraCharacterSheet.#onReward,
      earnKarma: PentraCharacterSheet.#onEarnKarma,
      visitClinic: PentraCharacterSheet.#onVisitClinic,
      socialize: PentraCharacterSheet.#onSocialize,
      treatWounds: PentraCharacterSheet.#onTreatWounds,
      stabilize: PentraCharacterSheet.#onStabilize,
      toggleAncestry: PentraCharacterSheet.#onToggleAncestry,
      finishCreation: PentraCharacterSheet.#onFinishCreation,
      stepLanguage: PentraCharacterSheet.#onStepLanguage,
      reopenCreation: PentraCharacterSheet.#onReopenCreation,
      takeScar: PentraCharacterSheet.#onTakeScar,
      addProject: PentraCharacterSheet.#onAddProject,
      removeProject: PentraCharacterSheet.#onRemoveProject,
      workProject: PentraCharacterSheet.#onWorkProject,
      run: PentraCharacterSheet.#onRun,
      surface: PentraCharacterSheet.#onSurface
    }
  };

  static #onStepLanguage(event, target) {
    const languages = foundry.utils.deepClone(this.actor.system._source.languages);
    const lang = languages[Number(target.dataset.index)];
    if (!lang) return;
    const value = Math.clamp(lang.value + Number(target.dataset.delta), 0, PENTRA.maxSkill);
    if (value === lang.value) return;
    lang.value = value;
    return this.actor.update({ "system.languages": languages });
  }

  static #onStabilize() {
    return Rolls.stabilize(this.actor);
  }

  static #onTreatWounds() {
    return Rolls.treatWounds(this.actor);
  }

  static #onFinishCreation() {
    return this.actor.finishCreation();
  }

  static #onReopenCreation() {
    return this.actor.reopenCreation();
  }

  /** Whether the ancestry details panel in the header is expanded. */
  _showAncestry = false;

  static #onToggleAncestry() {
    this._showAncestry = !this._showAncestry;
    this.render();
  }

  static PARTS = {
    header: { template: `${TEMPLATES}/character-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    skills: { template: `${TEMPLATES}/tab-skills.hbs`, scrollable: [""] },
    combat: { template: `${TEMPLATES}/tab-combat.hbs`, scrollable: [""] },
    gear: { template: `${TEMPLATES}/tab-gear.hbs`, scrollable: [""] },
    traits: { template: `${TEMPLATES}/tab-traits.hbs`, scrollable: [""] },
    downtime: { template: `${TEMPLATES}/tab-downtime.hbs`, scrollable: [""] },
    biography: { template: `${TEMPLATES}/tab-biography.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "skills", icon: "fa-solid fa-dice-d12" },
        { id: "combat", icon: "fa-solid fa-crosshairs" },
        { id: "gear", icon: "fa-solid fa-backpack" },
        { id: "traits", icon: "fa-solid fa-dna" },
        { id: "downtime", icon: "fa-solid fa-mug-hot" },
        { id: "biography", icon: "fa-solid fa-book-open" }
      ],
      initial: "skills",
      labelPrefix: "PENTRA.Tab"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    Object.assign(context.dice, {
      deathDie: dieOptions(PENTRA.usageDice, { zero: true }),
      resourceDie: dieOptions(PENTRA.usageDice, { zero: true }),
      drainDie: dieOptions(PENTRA.usageDice, { zero: true })
    });
    context.evasionBreakdown = this._evasionBreakdown();
    context.pendingScars = this.actor.getFlag(SYSTEM, "pendingScars") ?? 0;
    context.scars = (this.actor.getFlag(SYSTEM, "scars") ?? []).map(k => loc(PENTRA.attributes[k] ?? k));
    context.running = this.actor.statuses.has("running");
    context.breath = Underwater.breathContext(this.actor);
    context.projects = this._prepareProjects();
    context.projectDice = { 0: "—", 4: "d4", 6: "d6", 8: "d8", 10: "d10", 12: "d12" };
    context.projectMultipliers = Object.fromEntries([1, 2, 3, 4, 5, 6].map(m => [m, `x${m}`]));
    context.sizeLabel = loc(PENTRA.creatureSizes[sys.size] ?? "PENTRA.CreatureSize.medium");
    context.showDrain = game.settings.get(SYSTEM, "showDrainDie");
    context.nextTalentCost = karmaCostTalent(sys.talentCount);
    this._prepareCreation(context);
    context.lifestyles = Object.fromEntries(Object.entries(PENTRA.lifestyles).map(([k, v]) => [k, `${loc(v.label)} (${formatDie(v.die)})`]));
    context.currentLifestyle = sys.lifestyle ? loc(PENTRA.lifestyles[sys.lifestyle].label) : null;
    context.socialSkills = Object.fromEntries(PENTRA.socialSkills.map(k => [k, `${loc(PENTRA.skills[k].label)} (${sys.skills[k]})`]));
    context.kits = {
      reloading: this.actor.items.find(i => i.type === "fieldkit" && i.system.kitType === "reloading"),
      technical: this.actor.items.find(i => i.type === "fieldkit" && i.system.kitType === "technical"),
      trauma: this.actor.items.find(i => i.type === "fieldkit" && i.system.kitType === "trauma")
    };
    context.enrichedBiography = await TextEditor.implementation.enrichHTML(sys.biography, { relativeTo: this.actor, secrets: this.actor.isOwner });
    const ancestry = sys.ancestry;
    context.ancestry = ancestry ? {
      id: ancestry.id,
      name: ancestry.name,
      img: ancestry.img,
      boostLabel: ancestry.system.attributeBoost ? loc(PENTRA.attributes[ancestry.system.attributeBoost]) : null,
      description: await TextEditor.implementation.enrichHTML(ancestry.system.description, { relativeTo: ancestry, secrets: this.actor.isOwner })
    } : null;
    context.showAncestry = this._showAncestry;
    context.isDead = this.actor.statuses.has("dead");
    return context;
  }

  /**
   * Character-creation state. While creating, players are capped at the creation limits; once creation is
   * finished, players can only raise stats with Karma, so the inputs lock.
   */
  _prepareCreation(context) {
    const actor = this.actor;
    const isGM = game.user.isGM;
    const active = actor.inCreation;
    const enforce = active && !isGM;
    const budget = actor.getCreationBudget();
    const meter = ({ used, budget: total }) => ({ used, budget: total, over: used > total, done: used === total });
    const caps = {
      attr: enforce ? CREATION.maxAttributeRank : PENTRA.maxAttributeRank,
      res: enforce ? CREATION.maxResistanceRank : PENTRA.maxAttributeRank,
      skill: enforce ? CREATION.maxSkill : PENTRA.maxSkill
    };
    context.creation = {
      active, isGM,
      locked: !active && !isGM,
      skillCap: caps.skill,
      nativeCap: enforce ? CREATION.nativeLanguageRank : PENTRA.maxSkill,
      attributes: meter(budget.attributes),
      resistances: meter(budget.resistances),
      skills: meter(budget.skills),
      hindrances: { ...budget.hindrances, over: budget.hindrances.used > budget.hindrances.max },
      talents: { ...budget.talents, over: budget.talents.used > budget.talents.max },
      errors: budget.errors.map(e => game.i18n.format(e.key, e.data ?? {})),
      warnings: budget.warnings.map(w => game.i18n.format(w.key, w.data ?? {}))
    };
    // Skill steppers: + is available up to the cap and while points remain (players in creation);
    // after creation players can't step at all (they advance with Karma).
    const canStep = !context.creation.locked;
    const budgetFull = enforce && budget.skills.used >= budget.skills.budget;
    const stepper = (value, cap) => ({
      canStep,
      canRaise: canStep && value < cap && !budgetFull,
      canLower: canStep && value > 0
    });
    for (const attr of context.attributes) {
      for (const skill of attr.skills) Object.assign(skill, stepper(skill.value, caps.skill));
    }
    for (const lang of context.languages) {
      Object.assign(lang, stepper(lang.value, lang.isNative ? context.creation.nativeCap : caps.skill));
      // The native language is free, so a full budget doesn't stop it.
      if (lang.isNative && budgetFull) lang.canRaise = canStep && lang.value < context.creation.nativeCap;
    }

    const choices = cap => PENTRA.attributeRanks.map((_, i) => ({ value: i, label: formatAttribute(i), disabled: i > cap }));
    context.attrRankChoices = choices(caps.attr);
    context.resRankChoices = choices(caps.res);
  }

  /**
   * Explain where Evasion comes from, e.g. "9 +2 Quick −2 Leather Long Coat".
   * Returns null when it's just the default.
   */
  _evasionBreakdown() {
    const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
    const parts = [String(PENTRA.traits.evasion.base)];
    let worn = 0;
    for (const item of this.actor.items) {
      if (["hindrance", "talent"].includes(item.type) && item.system.trait === "evasion" && item.system.delta) {
        parts.push(`${signed(item.system.delta)} ${item.name}`);
      }
      if (item.type === "armor" && item.system.equipped) {
        worn++;
        if (item.system.evasion) parts.push(`${signed(item.system.evasion)} ${item.name}`);
      }
    }
    if (worn >= 3) parts.push(`−1 ${loc("PENTRA.Armor.Stacked")}`);
    if (this.actor.statuses.has("restrained")) parts.push(`÷2 ${loc("PENTRA.Status.restrained")}`);
    return parts.length > 1 ? parts.join(" ") : null;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  static #onImproveRank(event, target) {
    return this.actor.improveRank(target.dataset.group, target.dataset.key);
  }

  static #onImproveSkill(event, target) {
    return this.actor.improveSkill(target.dataset.key);
  }

  static #onImproveLanguage(event, target) {
    return this.actor.improveLanguage(Number(target.dataset.index));
  }

  static #onAddLanguage() {
    const languages = foundry.utils.deepClone(this.actor.system._source.languages);
    languages.push({ name: "", value: 0, native: false });
    return this.actor.update({ "system.languages": languages });
  }

  static #onRemoveLanguage(event, target) {
    const languages = foundry.utils.deepClone(this.actor.system._source.languages);
    languages.splice(Number(target.dataset.index), 1);
    return this.actor.update({ "system.languages": languages });
  }

  static #onSupport() {
    return Rolls.supportAlly(this.actor);
  }

  /** Generic Resource Die usage check (1-2). */
  static #onResourceUsage() {
    const actor = this.actor;
    return Rolls.rollUsage({
      actor, label: loc("PENTRA.Trait.resourceDie"), die: actor.system.resourceDie.value, range: 2,
      onReduce: next => actor.update({ "system.resourceDie.value": next }, { pentraMechanic: true })
    });
  }

  /** Pay for a day's lifestyle during city downtime. */
  /** Pay for a day's lifestyle (city downtime). */
  static #onLifestyle() {
    const key = this.element.querySelector("select.lifestyle-select")?.value ?? "middle";
    return Rolls.payLifestyle(this.actor, key);
  }

  /**
   * GM: award end-of-session Karma. Session complete is always +2; add a story arc (minor +2 / major +8)
   * and the GM's choice (0–6).
   */
  static async #onEarnKarma() {
    const L = key => game.i18n.localize(key);
    const SESSION = KARMA_SESSION;
    const ARCS = KARMA_ARCS;
    const arcRadios = Object.entries(ARCS).map(([k, n], i) => `
      <label class="radio"><input type="radio" name="arc" value="${k}" ${i === 0 ? "checked" : ""}>
        ${L(`PENTRA.Karma.Arc.${k}`)}${n ? ` (+${n})` : ""}</label>`).join("");
    const content = `<div class="pentra karma-earn">
      <div class="form-group"><label>${L("PENTRA.Karma.Reason.session")}</label><span class="fixed">+${SESSION}</span></div>
      <div class="form-group"><label>${L("PENTRA.Karma.ArcLabel")}</label><div class="form-fields radios">${arcRadios}</div></div>
      <div class="form-group"><label>${L("PENTRA.Karma.Reason.misc")}</label>
        <div class="form-fields"><input type="range" name="gm" min="0" max="6" step="1" value="0"><span class="range-value">+0</span></div></div>
      <div class="form-group total"><label>${L("PENTRA.Karma.Total")}</label><strong class="karma-total">${SESSION}</strong></div>
    </div>`;

    const read = form => {
      const arc = form.querySelector("[name=arc]:checked")?.value ?? "none";
      const gm = Number(form.querySelector("[name=gm]").value) || 0;
      return { arc, gm, total: SESSION + ARCS[arc] + gm };
    };

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: L("PENTRA.Karma.Earn"), icon: "fa-solid fa-star" },
      content,
      render: (event, dialog) => {
        const root = dialog.element;
        const update = () => {
          const { gm, total } = read(root);
          root.querySelector(".range-value").textContent = `+${gm}`;
          root.querySelector(".karma-total").textContent = total;
        };
        root.querySelectorAll("[name=arc], [name=gm]").forEach(el => el.addEventListener("input", update));
      },
      ok: { label: "PENTRA.Karma.Award", icon: "fa-solid fa-star", callback: (e, button) => read(button.form) },
      rejectClose: false
    });
    if (!result) return;

    const parts = [`${L("PENTRA.Karma.Reason.session")} +${SESSION}`];
    if (ARCS[result.arc]) parts.push(`${L(`PENTRA.Karma.Arc.${result.arc}`)} +${ARCS[result.arc]}`);
    if (result.gm) parts.push(`${L("PENTRA.Karma.Reason.misc")} +${result.gm}`);
    return this.actor.awardKarma(result.total, parts.join(", "));
  }

  static #onReward() {
    if (!game.user.isGM) return;
    return Rolls.promptReward(this.actor);
  }

  static #onRestockAmmo() {
    return Rolls.restockAmmo(this.actor);
  }

  static #onVisitClinic() {
    return Rolls.visitClinic(this.actor);
  }

  static #onSocialize() {
    const skill = this.element.querySelector("select.socialize-select")?.value ?? "persuasion";
    return Rolls.socialize(this.actor, skill);
  }

  static #onRefreshKits() {
    return this.actor.refreshKits();
  }

  /** Projects as display rows. */
  _prepareProjects() {
    return this.actor.system.projects.map(p => {
      const target = projectTarget(p.value);
      const done = p.phase === "done";
      const phase = p.phase === "research" && p.blueprint ? "crafting" : p.phase;
      return {
        ...p,
        valueLabel: p.value.die ? `d${p.value.die}${p.value.multiplier > 1 ? `x${p.value.multiplier}` : ""}` : null,
        targetLabel: target ? formatDie(target) : null,
        phaseLabel: loc(`PENTRA.Project.Phase.${phase}`),
        progressLabel: p.progress ? formatDie(p.progress) : "0",
        percent: target && !done ? Math.round(100 * [0, 4, 6, 8, 10, 12, 14].indexOf(p.progress) / Math.max([0, 4, 6, 8, 10, 12, 14].indexOf(target), 1)) : 100,
        done,
        canWork: !!target && !done && this.isEditable
      };
    });
  }

  /** Inline edits of a project's name (anyone) or value/blueprint (GM) from the Downtime tab. */
  _onRender(context, options) {
    super._onRender(context, options);
    for (const input of this.element.querySelectorAll("[data-project-field]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const projects = foundry.utils.deepClone(this.actor.system._source.projects);
        const project = projects.find(p => p.id === input.closest("[data-project-id]").dataset.projectId);
        if (!project) return;
        const value = input.type === "checkbox" ? input.checked : input.dataset.dtype === "Number" ? Number(input.value) : input.value;
        foundry.utils.setProperty(project, input.dataset.projectField, value);
        this.actor.update({ "system.projects": projects });
      });
    }
  }

  static #onAddProject() {
    const projects = foundry.utils.deepClone(this.actor.system._source.projects);
    projects.push({ id: foundry.utils.randomID(), name: "", value: { die: 0, multiplier: 1 }, blueprint: false, phase: "research", progress: 0, days: 0 });
    return this.actor.update({ "system.projects": projects });
  }

  static async #onRemoveProject(event, target) {
    const id = target.closest("[data-project-id]")?.dataset.projectId;
    const project = this.actor.system.projects.find(p => p.id === id);
    if (!project) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Project.Remove") },
      content: `<p>${game.i18n.format("PENTRA.Project.RemoveConfirm", { name: foundry.utils.escapeHTML(project.name || loc("PENTRA.Project.Unnamed")) })}</p>`
    });
    if (!ok) return;
    const projects = foundry.utils.deepClone(this.actor.system._source.projects).filter(p => p.id !== id);
    return this.actor.update({ "system.projects": projects });
  }

  static #onWorkProject(event, target) {
    return Rolls.workOnProject(this.actor, target.closest("[data-project-id]")?.dataset.projectId);
  }

  static #onTakeScar() {
    return Rolls.chooseScar(this.actor);
  }

  /** Declare moving past Close this round: up to Far, at -2 to everything until the end of the turn. */
  static #onRun() {
    return this.actor.toggleStatusEffect("running");
  }

  /** Underwater: come up for air (breath resets, drowning ends). */
  static #onSurface() {
    return Underwater.surface(this.actor);
  }

  static #onBlaze(event, target) {
    const weapon = target.dataset.itemId ? this.actor.items.get(target.dataset.itemId) : this._getItem(target);
    return Rolls.blazeOfGlory(this.actor, weapon ?? null);
  }

  /** Downtime recovery: camp (1 wound) or a day of rest (2 wounds). */
  /** Camp rest (1 wound) or a day of city rest (2 wounds, +1 with Extreme Luxury). */
  static #onRest(event, target) {
    return Rolls.rest(this.actor, target.dataset.kind);
  }
}

/* -------------------------------------------------------------------------- */

export class PentraNPCSheet extends PentraActorSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ["npc"],
    position: { width: 600, height: 700 }
  };

  static PARTS = {
    body: { template: `${TEMPLATES}/npc-sheet.hbs`, scrollable: [".npc-body"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.initDice = dieOptions([4, 6, 8, 10, 12]);
    context.enrichedNotes = await TextEditor.implementation.enrichHTML(this.actor.system.notes, { relativeTo: this.actor, secrets: this.actor.isOwner });
    return context;
  }
}
