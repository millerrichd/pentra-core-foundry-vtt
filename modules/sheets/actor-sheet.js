import { PENTRA } from "../config.js";
import { formatDie, formatAttribute, karmaCostAttribute, karmaCostSkill, karmaCostTalent, reloadRange, medicineHealing } from "../rules.js";
import * as Rolls from "../rolls.js";

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
      itemBuy: PentraActorSheetBase.#onItemBuy,
      itemSell: PentraActorSheetBase.#onItemSell,
      itemPost: PentraActorSheetBase.#onItemPost,
      repairArmor: PentraActorSheetBase.#onRepairArmor,
      toggleEdit: PentraActorSheetBase.#onToggleEdit
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
    context.languages = sys.languages.map((l, index) => ({ ...l, index, karmaCost: karmaCostSkill(l.value) }));
    context.armorByLocation = Object.entries(PENTRA.hitLocations).map(([key, l]) => ({
      key, label: loc(l.label), value: sys.armor?.[key] ?? 0
    }));
    context.items = this._prepareItems();
    context.martialArts = PENTRA.martialArts[sys.skills.martial_arts];
    return context;
  }

  _prepareSkills(attribute) {
    const sys = this.actor.system;
    const skills = [];
    for (const [key, s] of Object.entries(PENTRA.skills)) {
      if (s.attribute !== attribute) continue;
      const value = sys.skills[key];
      if (!this._editMode && !value && this.actor.type === "npc") continue;
      skills.push({ key, value, label: loc(s.label), karmaCost: karmaCostSkill(value), trained: value > 0 });
    }
    return skills;
  }

  _prepareItems() {
    const groups = { ancestry: [], hindrance: [], talent: [], armor: [], weapon: [], fieldkit: [], gear: [], vehicle: [] };
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
        case "gear":
        case "vehicle":
          entry.cost = item.system.costLabel;
          break;
        case "hindrance":
        case "talent":
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
    if (weapon) return Rolls.rollCheck(this.actor, { type: "attack", weapon, skipDialog: event.shiftKey });
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("DOCUMENT.New", { type: loc(CONFIG.Item.typeLabels[type]) });
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
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
    let range = 2;
    let note;
    if (item.system.kitType === "reloading" && this.actor.type === "character") {
      const rounds = this.actor.system.roundsFired;
      range = reloadRange(rounds);
      note = game.i18n.format("PENTRA.Kit.ReloadNote", { rounds });
      await this.actor.update({ "system.roundsFired": 0 });
    } else if (item.system.kitType === "trauma") {
      const rank = this.actor.system.skills.medicine;
      note = game.i18n.format("PENTRA.Kit.TraumaNote", { wounds: medicineHealing(rank) });
    }
    return Rolls.rollUsage({
      actor: this.actor, label: item.name, die: item.system.usage, range, note,
      onReduce: next => item.update({ "system.usage": next })
    });
  }

  static async #onItemBuy(event, target) {
    const item = this._getItem(target);
    if (!item) return;
    return Rolls.purchase(this.actor, { label: item.name, costDie: item.system.cost.die, multiplier: item.system.cost.multiplier });
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
  static async #onRepairArmor(event, target) {
    const item = this._getItem(target);
    if (!item) return;
    const die = this.actor.system.durabilityDie?.value ?? 8;
    const msg = await Rolls.rollCheck(this.actor, { type: "skill", key: "crafting" });
    if (msg?.getFlag(SYSTEM, "success")) {
      await item.update({ "system.durability": die });
      ui.notifications.info(game.i18n.format("PENTRA.Armor.Repaired", { name: item.name, die: formatDie(die) }));
    }
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
      newSession: PentraCharacterSheet.#onNewSession,
      support: PentraCharacterSheet.#onSupport,
      resourceUsage: PentraCharacterSheet.#onResourceUsage,
      lifestyle: PentraCharacterSheet.#onLifestyle,
      refreshKits: PentraCharacterSheet.#onRefreshKits,
      deathCheck: PentraCharacterSheet.#onDeathCheck,
      blaze: PentraCharacterSheet.#onBlaze,
      rest: PentraCharacterSheet.#onRest
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/character-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    skills: { template: `${TEMPLATES}/tab-skills.hbs`, scrollable: [""] },
    combat: { template: `${TEMPLATES}/tab-combat.hbs`, scrollable: [""] },
    gear: { template: `${TEMPLATES}/tab-gear.hbs`, scrollable: [""] },
    traits: { template: `${TEMPLATES}/tab-traits.hbs`, scrollable: [""] },
    biography: { template: `${TEMPLATES}/tab-biography.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "skills", icon: "fa-solid fa-dice-d12" },
        { id: "combat", icon: "fa-solid fa-crosshairs" },
        { id: "gear", icon: "fa-solid fa-backpack" },
        { id: "traits", icon: "fa-solid fa-dna" },
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
    context.traitBlock = [
      { key: "durabilityDie", label: loc(PENTRA.traits.durabilityDie.label), value: formatDie(sys.durabilityDie.value) },
      { key: "initiativeDie", label: loc(PENTRA.traits.initiativeDie.label), value: formatDie(sys.initiativeDie.value) },
      { key: "evasion", label: loc(PENTRA.traits.evasion.label), value: sys.evasion.value,
        hint: sys.armorEvasion ? `${sys.evasion.base} ${sys.armorEvasion}` : null }
    ];
    context.showDrain = game.settings.get(SYSTEM, "showDrainDie");
    context.nextTalentCost = karmaCostTalent(sys.talentCount);
    context.skillPoints = Object.values(sys.skills).reduce((a, b) => a + b, 0);
    context.lifestyles = Object.fromEntries(Object.entries(PENTRA.lifestyles).map(([k, v]) => [k, `${loc(v.label)} (${formatDie(v.die)})`]));
    context.enrichedBiography = await TextEditor.implementation.enrichHTML(sys.biography, { relativeTo: this.actor, secrets: this.actor.isOwner });
    context.ancestry = sys.ancestry;
    return context;
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
    languages.push({ name: "", value: 1 });
    return this.actor.update({ "system.languages": languages });
  }

  static #onRemoveLanguage(event, target) {
    const languages = foundry.utils.deepClone(this.actor.system._source.languages);
    languages.splice(Number(target.dataset.index), 1);
    return this.actor.update({ "system.languages": languages });
  }

  static #onNewSession() {
    return this.actor.startSession();
  }

  static #onSupport() {
    return Rolls.supportAlly(this.actor);
  }

  /** Generic Resource Die usage check (1-2). */
  static #onResourceUsage() {
    const actor = this.actor;
    return Rolls.rollUsage({
      actor, label: loc("PENTRA.Trait.resourceDie"), die: actor.system.resourceDie.value, range: 2,
      onReduce: next => actor.update({ "system.resourceDie.value": next })
    });
  }

  /** Pay for a day's lifestyle during city downtime. */
  static async #onLifestyle() {
    const select = this.element.querySelector("select.lifestyle-select");
    const key = select?.value ?? "middle";
    const lifestyle = PENTRA.lifestyles[key];
    const label = loc(lifestyle.label);
    if (key === "street") {
      return Rolls.rollUsage({ actor: this.actor, label, die: 8, range: 2, note: loc("PENTRA.Lifestyle.streetNote") });
    }
    return Rolls.purchase(this.actor, { label, costDie: lifestyle.die, multiplier: 1 });
  }

  static #onRefreshKits() {
    return this.actor.refreshKits();
  }

  static #onDeathCheck() {
    return Rolls.deathDieCheck(this.actor);
  }

  static #onBlaze(event, target) {
    const weapon = target.dataset.itemId ? this.actor.items.get(target.dataset.itemId) : this._getItem(target);
    return Rolls.blazeOfGlory(this.actor, weapon ?? null);
  }

  /** Downtime recovery: camp (1 wound) or a day of rest (2 wounds). */
  static async #onRest(event, target) {
    const amount = Number(target.dataset.amount) || 1;
    const value = await Rolls.healWounds(this.actor, amount);
    ui.notifications.info(game.i18n.format("PENTRA.Rest.Healed", { name: this.actor.name, amount, value }));
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
