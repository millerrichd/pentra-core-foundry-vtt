import { PENTRA } from "./config.js";
import {
  stepDie, actionsFromInitiative, formatDie, karmaCostAttribute, karmaCostSkill, karmaCostTalent,
  KARMA_BUY_OFF_HINDRANCE, formatAttribute
} from "./rules.js";

const SYSTEM = "pentra-core-foundry-vtt";
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/* -------------------------------------------------------------------------- */
/*  Actor                                                                     */
/* -------------------------------------------------------------------------- */

export class PentraActor extends Actor {
  /** @override */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const updates = {};
    if (!foundry.utils.hasProperty(data, "prototypeToken.bar1.attribute")) {
      updates["prototypeToken.bar1.attribute"] = "health";
    }
    if (this.type === "character") {
      updates["prototypeToken.actorLink"] = true;
      updates["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      if (!data.system?.languages?.length) {
        updates["system.languages"] = [{ name: loc("PENTRA.NativeLanguage"), value: PENTRA.nativeLanguageRank }];
      }
    }
    this.updateSource(updates);
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
    await this.update({ "system.edge.value": this.system.edge.start });
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
    await this.update({ "system.karma.value": karma - cost, ...updates });
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
    await this.update({ "system.karma.value": karma - KARMA_BUY_OFF_HINDRANCE });
    await item.delete();
  }

  /** Refill every field kit to the character's Durability Die. */
  async refreshKits() {
    const die = this.system.durabilityDie?.value ?? 8;
    const updates = this.items.filter(i => i.type === "fieldkit").map(i => ({ _id: i.id, "system.usage": die }));
    await this.updateEmbeddedDocuments("Item", updates);
    ui.notifications.info(fmt("PENTRA.Kit.Refreshed", { die: formatDie(die) }));
  }

  /** Award Karma (GM tool). */
  async awardKarma(amount) {
    await this.update({
      "system.karma.value": this.system.karma.value + amount,
      "system.karma.earned": this.system.karma.earned + amount
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Item                                                                      */
/* -------------------------------------------------------------------------- */

export class PentraItem extends Item {
  /** @override */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const actor = this.parent;
    if (!(actor instanceof Actor)) return;
    const die = actor.system.durabilityDie?.value ?? 8;
    // Armor durability and kit usage dice start at the owner's Durability Die.
    if (this.type === "armor" && this.system.durability === null) this.updateSource({ "system.durability": die });
    if (this.type === "fieldkit" && this.system.usage === null) this.updateSource({ "system.usage": die });
    // Only one ancestry per character.
    if (this.type === "ancestry" && actor.items.some(i => i.type === "ancestry")) {
      ui.notifications.warn(loc("PENTRA.Ancestry.OnlyOne"));
      return false;
    }
  }

  /** @override */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (userId === game.user.id) this.#applyToActor(1);
  }

  /** @override */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    if (userId === game.user.id) this.#applyToActor(-1);
  }

  /**
   * Ancestries boost an attribute; hindrances and talents shift the current value of pool-style traits
   * (Health, Edge, Death/Resource/Drain Die) so a freshly built character starts at the right values.
   * Maximums are derived, so they don't need to be written.
   * @param {1|-1} direction  1 when added, -1 when removed
   */
  #applyToActor(direction) {
    const actor = this.parent;
    if (!(actor instanceof Actor) || actor.type !== "character") return;
    const sys = actor.system;

    if (this.type === "ancestry" && this.system.attributeBoost) {
      const key = this.system.attributeBoost;
      const rank = Math.clamp(sys.attributes[key].rank + direction, 0, PENTRA.maxAttributeRank);
      return actor.update({ [`system.attributes.${key}.rank`]: rank });
    }

    if (!["hindrance", "talent"].includes(this.type) || !this.system.trait) return;
    const delta = this.system.delta * direction;
    switch (this.system.trait) {
      case "health":
        return actor.update({ "system.health.value": Math.max(sys.health.value + delta, 0) });
      case "edge":
        return actor.update({ "system.edge.value": Math.clamp(sys.edge.value + delta, 0, PENTRA.maxEdge) });
      case "deathDie":
      case "resourceDie":
      case "drainDie": {
        const path = `system.${this.system.trait}.value`;
        return actor.update({ [path]: stepDie(foundry.utils.getProperty(actor, path), delta) });
      }
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
export function onUpdateCombat(combat, changed, options) {
  if (!("round" in changed) || changed.round <= 1) return;
  if (!game.users.activeGM?.isSelf) return;
  if (!game.settings.get(SYSTEM, "rerollInitiative")) return;
  // Only when advancing (not rewinding).
  if (options.direction !== 1) return;
  const ids = combat.combatants.filter(c => !c.isDefeated).map(c => c.id);
  // Keep the turn pointer at 0 so the new highest roll acts first.
  combat.rollInitiative(ids, { updateTurn: false });
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
    tag.textContent = `${formatDie(c.initiativeDie)}${actions ? ` · ${fmt("PENTRA.Initiative.Actions", { n: actions })}` : ""}`;
    name.after(tag);
  }
}
