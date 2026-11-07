/**
 * Roll handling: attribute/skill/resistance checks, attacks, damage, and usage-die checks.
 */
import { PENTRA } from "./config.js";
import {
  attributeStep, countWounds, edgeFromDice, netAdvantage, stepDie, formatDie, martialArtsDamage,
  purchaseRange, saleValue, saleThreshold, formatCost
} from "./rules.js";

const SYSTEM = "pentra-core-foundry-vtt";
const TEMPLATES = `systems/${SYSTEM}/templates`;
const { renderTemplate } = foundry.applications.handlebars;
const { DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

export function defaultTN() {
  return game.settings.get(SYSTEM, "targetNumber") ?? PENTRA.defaultTN;
}

/** Sum of flat penalties from statuses such as Shaken or a head wound. */
function statusPenalty(actor) {
  let total = 0;
  const notes = [];
  for (const [status, value] of Object.entries(PENTRA.penaltyStatuses)) {
    if (actor.statuses?.has(status)) {
      total += value;
      notes.push(`${loc(`PENTRA.Status.${status}`)} ${value}`);
    }
  }
  return { total, notes };
}

/** The single targeted token's actor, if exactly one token is targeted. */
function singleTarget() {
  const targets = Array.from(game.user.targets);
  return targets.length === 1 ? targets[0] : null;
}

/* -------------------------------------------------------------------------- */
/*  Checks                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the description of what is being rolled.
 * @param {Actor} actor
 * @param {object} spec
 * @param {"attribute"|"resistance"|"skill"|"language"|"attack"} spec.type
 * @param {string} [spec.key]        Attribute, resistance, or skill key; language index
 * @param {Item}   [spec.weapon]     For attacks
 * @param {boolean} [spec.unarmed]   Martial Arts attack
 */
function describeCheck(actor, spec) {
  const sys = actor.system;
  let attrKey, skillValue = 0, label, isResistance = false, skillKey = null;

  switch (spec.type) {
    case "attribute":
      attrKey = spec.key;
      label = loc(PENTRA.attributes[attrKey]);
      break;
    case "resistance":
      attrKey = spec.key;
      isResistance = true;
      label = loc(PENTRA.resistances[attrKey]);
      break;
    case "skill":
      skillKey = spec.key;
      attrKey = PENTRA.skills[skillKey].attribute;
      skillValue = sys.skills[skillKey] ?? 0;
      label = loc(PENTRA.skills[skillKey].label);
      break;
    case "language": {
      const lang = sys.languages[spec.key];
      attrKey = "knowledge";
      skillValue = lang?.value ?? 0;
      label = `${loc("PENTRA.Languages")}: ${lang?.name || "?"}`;
      break;
    }
    case "attack": {
      skillKey = spec.unarmed ? "martial_arts" : spec.weapon.system.skill;
      attrKey = PENTRA.skills[skillKey].attribute;
      skillValue = sys.skills[skillKey] ?? 0;
      label = spec.unarmed ? loc("PENTRA.Unarmed") : spec.weapon.name;
      break;
    }
  }

  const group = isResistance ? sys.resistances : sys.attributes;
  const { die, bonus } = attributeStep(group[attrKey].rank);
  return { attrKey, skillKey, skillValue, die, bonus, label, isResistance };
}

/**
 * Show the roll dialog. Returns null if cancelled.
 */
async function promptCheck(actor, { label, tn, isAttack, canSpendEdge, penalty, weapon }) {
  const content = await renderTemplate(`${TEMPLATES}/dialog/roll-dialog.hbs`, {
    tn, isAttack, canSpendEdge, penalty,
    edge: actor.system.edge?.value,
    locations: Object.fromEntries(Object.entries(PENTRA.hitLocations).map(([k, v]) =>
      [k, `${loc(v.label)} (${v.modifier >= 0 ? "+" : ""}${v.modifier})`])),
    cover: PENTRA.situationalModifiers.cover.options,
    light: PENTRA.situationalModifiers.light.options,
    isRanged: weapon && weapon.system.category !== "melee"
  });
  return DialogV2.wait({
    window: { title: fmt("PENTRA.Roll.DialogTitle", { label }), icon: "fa-solid fa-dice-d12" },
    position: { width: 420 },
    content,
    rejectClose: false,
    buttons: [{
      action: "roll",
      label: "PENTRA.Roll.Roll",
      icon: "fa-solid fa-dice",
      default: true,
      callback: (event, button) => new FormDataExtended(button.form).object
    }]
  });
}

/**
 * Perform a check and post it to chat.
 * @param {Actor} actor
 * @param {object} spec  See describeCheck. Also accepts `skipDialog` and `options` (pre-filled dialog values).
 */
export async function rollCheck(actor, spec) {
  const desc = describeCheck(actor, spec);
  const isAttack = spec.type === "attack";
  const isCharacter = actor.type === "character";
  const penalty = statusPenalty(actor);

  // Default target number: the target's Evasion for attacks, otherwise the standard TN.
  const target = isAttack ? singleTarget() : null;
  const targetEvasion = target?.actor?.system.evasion?.value;
  let tn = Number.isNumeric(targetEvasion) ? targetEvasion : defaultTN();

  let opts = { tn, modifier: 0, advantage: 0, spendEdge: false, location: "torso", cover: 0, light: 0, aim: false, push: false, ...(spec.options ?? {}) };
  if (!spec.skipDialog) {
    const result = await promptCheck(actor, {
      label: desc.label, tn, isAttack, penalty,
      canSpendEdge: isCharacter && actor.system.edge.value >= 2,
      weapon: spec.weapon
    });
    if (!result) return null;
    opts = { ...opts, ...result };
  }

  // Modifiers
  const parts = [];
  let modifier = Number(opts.modifier) || 0;
  if (modifier) parts.push(`${loc("PENTRA.Roll.Modifier")} ${modifier > 0 ? "+" : ""}${modifier}`);
  if (penalty.total) { modifier += penalty.total; parts.push(...penalty.notes); }
  if (opts.push) { modifier -= 2; parts.push(`${loc("PENTRA.Roll.Push")} -2`); }
  if (isAttack) {
    const locMod = PENTRA.hitLocations[opts.location]?.modifier ?? 0;
    if (locMod) { modifier += locMod; parts.push(`${loc(PENTRA.hitLocations[opts.location].label)} ${locMod}`); }
    for (const k of ["cover", "light"]) {
      const v = Number(opts[k]) || 0;
      if (v) { modifier += v; parts.push(`${loc(PENTRA.situationalModifiers[k].options[v])} ${v}`); }
    }
    if (opts.aim) { modifier += 2; parts.push(`${loc("PENTRA.Roll.Aim")} +2`); }
  }

  // Advantage: dialog choice plus optionally spending 2 Edge, which counts as one more source of advantage.
  const choice = Number(opts.advantage) || 0;
  const spendEdge = isCharacter && opts.spendEdge && actor.system.edge.value >= 2;
  const adv = netAdvantage((choice > 0 ? 1 : 0) + (spendEdge ? 1 : 0), choice < 0 ? 1 : 0);

  let formula = `1d${desc.die} + ${desc.bonus}`;
  if (desc.skillValue) formula += ` + ${desc.skillValue}`;
  if (modifier) formula += ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}`;
  if (adv > 0) formula += " + 1d6";
  else if (adv < 0) formula += " - 1d6";

  const roll = await new Roll(formula).evaluate();
  tn = Number(opts.tn) || tn;
  const success = roll.total >= tn;

  // Edge: gained when any die shows its min or max face.
  let edgeGained = 0;
  if (isCharacter) {
    const dice = roll.dice.flatMap(d => d.results.filter(r => r.active).map(r => ({ faces: d.faces, result: r.result })));
    edgeGained = edgeFromDice(dice);
    const current = actor.system.edge.value;
    const next = Math.clamp(current - (spendEdge ? 2 : 0) + edgeGained, 0, PENTRA.maxEdge);
    if (next !== current) await actor.update({ "system.edge.value": next });
  }

  // Attack damage
  let damage = null;
  if (isAttack) {
    const profile = spec.unarmed
      ? { ...martialArtsDamage(desc.skillValue), heavy: false }
      : { wounds: spec.weapon.system.wounds, increment: spec.weapon.system.increment, heavy: spec.weapon.system.heavy };
    const wounds = countWounds({ base: profile.wounds, increment: profile.increment, tn, total: roll.total, heavy: profile.heavy });
    damage = {
      wounds,
      location: opts.location,
      locationLabel: loc(PENTRA.hitLocations[opts.location].label),
      profile: `${profile.wounds} (${loc(PENTRA.increments[profile.increment])})${profile.heavy ? " ×2" : ""}`
    };
    if (isCharacter && spec.weapon && spec.weapon.system.category === "ranged") {
      await actor.update({ "system.roundsFired": actor.system.roundsFired + 1 });
    }
  }

  const attrLabel = loc(desc.isResistance ? PENTRA.resistances[desc.attrKey] : PENTRA.attributes[desc.attrKey]);
  const content = await renderTemplate(`${TEMPLATES}/chat/check.hbs`, {
    label: desc.label,
    subtitle: desc.skillKey || spec.type === "language" ? `${attrLabel} d${desc.die}+${desc.bonus} · ${loc("PENTRA.Skill.label")} ${desc.skillValue}` : `d${desc.die}+${desc.bonus}`,
    rollHTML: await roll.render(),
    tn, success, isAttack,
    targetName: target?.name,
    advantage: adv > 0 ? loc("PENTRA.Roll.Advantage") : adv < 0 ? loc("PENTRA.Roll.Disadvantage") : null,
    spentEdge: spendEdge,
    edgeGained,
    modifiers: parts,
    damage
  });

  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { [SYSTEM]: { type: spec.type, success, damage, tn, targetUuid: target?.document?.uuid ?? null } }
  });
}

/* -------------------------------------------------------------------------- */
/*  Damage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Apply incoming wounds to an actor: subtract the AR at the hit location, reduce Health, apply Shaken,
 * and roll Durability usage checks for each piece of armor covering the location.
 * @param {Actor} actor
 * @param {number} wounds       Wounds before armor
 * @param {string} location     Hit location key
 */
export async function applyWounds(actor, wounds, location = "torso") {
  const sys = actor.system;
  const ar = sys.armor?.[location] ?? 0;
  const taken = Math.max(wounds - ar, 0);
  const health = Math.max(sys.health.value - taken, 0);
  const lines = [];

  await actor.update({ "system.health.value": health });
  if (taken > 0) {
    await actor.toggleStatusEffect("shaken", { active: true });
    if (location === "head") await actor.toggleStatusEffect("headWound", { active: true });
  }

  // Durability usage checks: range is 1..(total wounds before armor). Layered pieces each check.
  const armorRolls = [];
  if (wounds > 0) {
    for (const item of actor.items) {
      if (item.type !== "armor" || !item.system.equipped || !item.system.coverage[location]) continue;
      const die = item.system.durability;
      if (!die) continue;
      const roll = await new Roll(`1d${die}`).evaluate();
      armorRolls.push(roll);
      const reduced = roll.total <= wounds;
      const next = reduced ? stepDie(die, -1) : die;
      if (reduced) await item.update({ "system.durability": next });
      lines.push(fmt(reduced ? "PENTRA.Damage.ArmorDegraded" : "PENTRA.Damage.ArmorHeld", {
        name: item.name, roll: roll.total, range: wounds, die: next ? formatDie(next) : loc("PENTRA.Broken")
      }));
    }
  }

  // Incapacitation
  if (health === 0 && taken > 0) {
    if (actor.type === "character") {
      await actor.toggleStatusEffect("unconscious", { active: true });
      lines.push(loc("PENTRA.Damage.DeathMove"));
    } else {
      await actor.toggleStatusEffect("dead", { active: true, overlay: true });
      lines.push(fmt("PENTRA.Damage.Defeated", { name: actor.name }));
    }
  }

  const content = await renderTemplate(`${TEMPLATES}/chat/damage.hbs`, {
    name: actor.name, wounds, ar, taken, health, max: sys.health.max,
    location: loc(PENTRA.hitLocations[location].label), lines
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls: armorRolls });
}

/** Restore wounds (up to max Health). */
export async function healWounds(actor, amount) {
  const sys = actor.system;
  const value = Math.min(sys.health.value + amount, sys.health.max);
  await actor.update({ "system.health.value": value });
  if (value > 0 && actor.statuses.has("unconscious")) await actor.toggleStatusEffect("unconscious", { active: false });
  return value;
}

/* -------------------------------------------------------------------------- */
/*  Usage dice                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Roll a usage die. If the result falls within 1..range, the die shrinks a size.
 * @param {object} args
 * @param {Actor} args.actor
 * @param {string} args.label       What is being checked
 * @param {number} args.die         Current die faces
 * @param {number} args.range       Top of the 1..N range
 * @param {(next:number)=>Promise} [args.onReduce]  Called with the new die size when it shrinks
 * @param {string} [args.note]      Extra text for the card
 * @returns {Promise<{roll: Roll, reduced: boolean, die: number}>}
 */
export async function rollUsage({ actor, label, die, range, onReduce, note, min = 0 }) {
  if (!die) {
    ui.notifications.warn(fmt("PENTRA.Usage.Depleted", { label }));
    return null;
  }
  const roll = await new Roll(`1d${die}`).evaluate();
  const reduced = roll.total <= range;
  const next = reduced ? stepDie(die, -1, { min }) : die;
  if (reduced && onReduce) await onReduce(next);

  const content = await renderTemplate(`${TEMPLATES}/chat/usage.hbs`, {
    label, note, range, reduced,
    rollHTML: await roll.render(),
    from: formatDie(die), to: formatDie(next)
  });
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), content });
  return { roll, reduced, die: next };
}

/**
 * Buy an item (or a lifestyle) with the Resource Die.
 * @returns {Promise<boolean>} Whether the purchase went through.
 */
export async function purchase(actor, { label, costDie, multiplier = 1 }) {
  const resourceDie = actor.system.resourceDie.value;
  const range = purchaseRange({ costDie, multiplier, resourceDie });
  const cost = formatCost(costDie, multiplier);
  if (range === null) {
    ui.notifications.warn(fmt("PENTRA.Purchase.TooExpensive", { label, cost, die: formatDie(resourceDie) }));
    return false;
  }
  if (range === 0) return true; // Free
  await rollUsage({
    actor, label: fmt("PENTRA.Purchase.Label", { label }), die: resourceDie, range,
    note: `${cost} vs ${loc("PENTRA.Trait.resourceDie")} ${formatDie(resourceDie)}`,
    onReduce: next => actor.update({ "system.resourceDie.value": next })
  });
  return true;
}

/**
 * Sell an item to try to raise the Resource Die. Rolls repeatedly while the sale value still exceeds the die.
 */
export async function sell(actor, { label, costDie, multiplier = 1 }) {
  const value = saleValue({ costDie, multiplier });
  let die = actor.system.resourceDie.value;
  if (!die) die = 4;
  const rolls = [];
  const lines = [];
  let keepGoing = true;
  while (keepGoing) {
    const threshold = saleThreshold({ saleDie: value.die, saleMultiplier: value.multiplier, resourceDie: die });
    const roll = await new Roll(`1d${die}`).evaluate();
    rolls.push(roll);
    const raised = roll.total >= threshold && die < 12;
    lines.push(fmt(raised ? "PENTRA.Sell.Raised" : "PENTRA.Sell.NoChange", {
      die: formatDie(die), roll: roll.total, threshold, next: formatDie(stepDie(die, 1))
    }));
    if (!raised) break;
    die = stepDie(die, 1);
    keepGoing = value.die > die;
  }
  await actor.update({ "system.resourceDie.value": die });
  const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
    title: fmt("PENTRA.Sell.Label", { label }),
    subtitle: `${loc("PENTRA.Sell.Value")}: ${formatCost(value.die, value.multiplier)}`,
    lines
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls });
}

/* -------------------------------------------------------------------------- */
/*  Misc character actions                                                    */
/* -------------------------------------------------------------------------- */

/** Spend 1 Edge to support an ally: roll a d6 to add to their check. */
export async function supportAlly(actor) {
  if (actor.system.edge.value < 1) return ui.notifications.warn(loc("PENTRA.Edge.NotEnough"));
  await actor.update({ "system.edge.value": actor.system.edge.value - 1 });
  const roll = await new Roll("1d6").evaluate();
  const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
    title: loc("PENTRA.Edge.Support"),
    subtitle: loc("PENTRA.Edge.SupportHint"),
    rollHTML: await roll.render()
  });
  return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), content });
}

/**
 * Collapse & Risk a Scar: once stabilized, roll the Death Die. If it is at or under the number of rounds spent
 * unconscious, the character takes a scar and the Death Die shrinks. Below d4 the character dies.
 */
export async function deathDieCheck(actor) {
  const rounds = await DialogV2.prompt({
    window: { title: loc("PENTRA.Death.CheckTitle") },
    content: `<div class="form-group"><label>${loc("PENTRA.Death.Rounds")}</label>
      <input type="number" name="rounds" value="1" min="0" autofocus></div>`,
    ok: { label: "PENTRA.Roll.Roll", callback: (e, button) => Number(button.form.elements.rounds.value) || 0 },
    rejectClose: false
  });
  if (rounds === null || rounds === undefined) return;
  const die = actor.system.deathDie.value;
  const result = await rollUsage({
    actor, label: loc("PENTRA.Trait.deathDie"), die, range: rounds,
    note: loc("PENTRA.Death.ScarNote"),
    onReduce: next => actor.update({ "system.deathDie.value": next })
  });
  if (!result) {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${fmt("PENTRA.Death.Died", { name: actor.name })}</p>` });
    return;
  }
  if (result.reduced) {
    const msg = result.die === 0 ? fmt("PENTRA.Death.Died", { name: actor.name }) : loc("PENTRA.Death.Scar");
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>${msg}</strong></p>` });
    if (result.die === 0) await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  }
}

/** Blaze of Glory: an automatic 12 + skill attack dealing double wounds. */
export async function blazeOfGlory(actor, weapon) {
  const skillKey = weapon ? weapon.system.skill : "martial_arts";
  const skill = actor.system.skills[skillKey] ?? 0;
  const total = 12 + skill;
  const target = singleTarget();
  const tn = target?.actor?.system.evasion?.value ?? defaultTN();
  const profile = weapon
    ? { wounds: weapon.system.wounds, increment: weapon.system.increment, heavy: weapon.system.heavy }
    : { ...martialArtsDamage(skill), heavy: false };
  const wounds = 2 * countWounds({ base: profile.wounds, increment: profile.increment, tn, total, heavy: profile.heavy });
  const damage = { wounds, location: "torso", locationLabel: loc(PENTRA.hitLocations.torso.label), profile: loc("PENTRA.Death.BlazeProfile") };
  const content = await renderTemplate(`${TEMPLATES}/chat/check.hbs`, {
    label: `${loc("PENTRA.Death.Blaze")}: ${weapon?.name ?? loc("PENTRA.Unarmed")}`,
    subtitle: `12 + ${skill}`, total, tn, success: true, isAttack: true, targetName: target?.name, damage
  });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), content,
    flags: { [SYSTEM]: { type: "attack", damage, targetUuid: target?.document?.uuid ?? null } }
  });
}
