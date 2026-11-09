/**
 * Roll handling: attribute/skill/resistance checks, attacks, damage, and usage-die checks.
 */
import { PENTRA } from "./config.js";
import { chaseSituation, chaseTargetFor } from "./apps/chase-state.js";
import { actorUnderwater } from "./underwater.js";
import {
  attributeStep, countWounds, edgeFromDice, netAdvantage, stepDie, formatDie, martialArtsDamage,
  purchaseRange, saleValue, saleThreshold, formatCost, medicineHealing, reloadRange,
  RANGE_BANDS, bandForDistance, rangePenalty, allowedBands, sizeModifier, formatAttribute,
  projectTarget, nextProjectProgress, projectRollAdvances, CHASE_BANDS, chaseReach, underwaterRange
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

/**
 * Sum of flat penalties from statuses such as Shaken or a head wound, and from diseases that hamper all checks or
 * checks with one attribute.
 * @param {Actor} actor
 * @param {object} [desc]  The check being made (from describeCheck), for attribute-specific penalties
 */
function statusPenalty(actor, desc = {}) {
  let total = 0;
  const notes = [];
  for (const [status, value] of Object.entries(PENTRA.penaltyStatuses)) {
    if (actor.statuses?.has(status)) {
      total += value;
      notes.push(`${loc(`PENTRA.Status.${status}`)} ${value}`);
    }
  }
  // Drowning: -2 to everything except Athletics (swimming for the surface).
  if (actor.statuses?.has("drowning") && desc.skillKey !== "athletics") {
    total += PENTRA.underwater.drowningPenalty;
    notes.push(`${loc("PENTRA.Status.drowning")} ${PENTRA.underwater.drowningPenalty}`);
  }
  for (const disease of actor.items?.filter(i => i.type === "disease") ?? []) {
    const { effect, attribute, penalty } = disease.system;
    const applies = effect === "checks" || (effect === "attribute" && !desc.isResistance && desc.attrKey === attribute);
    if (applies && penalty) {
      total += penalty;
      notes.push(`${disease.name} ${penalty}`);
    }
  }
  return { total, notes };
}

/** The vehicle an actor is riding in (as driver or passenger), if any. */
export function vehicleCarrying(actor) {
  if (!actor || actor.type === "vehicle") return null;
  return game.actors.find(v => v.type === "vehicle"
    && (isActor(v.system.crew.driver, actor) || v.system.crew.passengers.some(u => isActor(u, actor)))) ?? null;
}

/**
 * Is the stored uuid this actor? Crew are usually dragged in from the sidebar, but an unlinked token (most NPCs)
 * acts through its own copy of the actor, so a token's actor also matches its base actor (and vice versa).
 */
export function isActor(uuid, actor) {
  if (!uuid || !actor) return false;
  if (uuid === actor.uuid) return true;
  if (actor.isToken && actor.token?.baseActor?.uuid === uuid) return true;
  const stored = fromUuidSync(uuid);
  return !!stored?.isToken && stored.token?.baseActor?.uuid === actor.uuid;
}

/** The actor's token on the current scene (a controlled one first). */
function tokenFor(actor) {
  const tokens = actor.getActiveTokens?.() ?? [];
  return tokens.find(t => t.controlled) ?? tokens[0] ?? null;
}

/** The range band between two tokens, measured on the grid (1 square = 1 yard). Null if it can't be measured. */
function measuredBand(fromToken, toToken) {
  if (!fromToken || !toToken || !canvas?.grid) return null;
  try {
    const { distance } = canvas.grid.measurePath([fromToken.center, toToken.center]);
    return bandForDistance(distance);
  } catch {
    return null;
  }
}

/** Do two tokens touch (side or corner) on a square grid? Falls back to a melee-band distance elsewhere. */
function adjacent(a, b) {
  if (!a || !b || a === b) return false;
  const grid = canvas?.grid;
  if (!grid) return false;
  if (grid.isSquare) {
    const size = grid.size;
    const box = t => ({ x: t.document.x / size, y: t.document.y / size, w: t.document.width, h: t.document.height });
    const A = box(a), B = box(b);
    const gapX = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));
    const gapY = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
    return gapX < 0.5 && gapY < 0.5;
  }
  return measuredBand(a, b) === "melee";
}

/** Statuses that take someone out of a melee: they can't fight, so they don't count as an ally or a foe. */
const OUT_OF_THE_FIGHT = ["dead", "unconscious"];

/** Tokens that count in a melee: visible, conscious, alive, and on a side (friendly or hostile). */
function combatTokens() {
  const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  return (canvas?.tokens?.placeables ?? []).filter(t => t.actor && !t.document.hidden
    && [FRIENDLY, HOSTILE].includes(t.document.disposition)
    && !OUT_OF_THE_FIGHT.some(s => t.actor.statuses.has(s))
    && !t.combatant?.isDefeated);
}

/**
 * Count the melee around an attack from the map: allies (the attacker's side) also next to the target, and foes
 * (the other side) next to the attacker beyond the first. Returns null if there aren't two tokens to measure.
 */
function meleeCrowd(myToken, target) {
  if (!myToken || !target) return null;
  const side = myToken.document.disposition;
  const tokens = combatTokens();
  const allies = tokens.filter(t => t !== myToken && t !== target && t.document.disposition === side && adjacent(t, target));
  const foes = tokens.filter(t => t !== myToken && t.document.disposition === -side && side !== 0 && adjacent(t, myToken));
  return { allies: allies.length, foes: Math.max(foes.length - 1, 0) };
}

/**
 * Can this attack reach the target? Melee weapons and unarmed strikes need the target adjacent; ranged weapons
 * fire at most one band past their preferred band. Only checked when both tokens are on the map.
 * @returns {string|null}  A warning to show, or null if the attack can go ahead.
 */
function reachProblem(actor, { weapon, unarmed, target }) {
  const myToken = tokenFor(actor);
  if (!myToken || !target || myToken === target) return null;
  const ranged = !unarmed && weapon && weapon.system.category !== "melee";
  if (!ranged) {
    return adjacent(myToken, target) ? null : fmt("PENTRA.Roll.NotAdjacent", {
      weapon: unarmed || !weapon ? loc("PENTRA.Unarmed") : weapon.name, target: target.name
    });
  }
  const band = measuredBand(myToken, target);
  const preferred = preferredRange(actor, weapon);
  if (!band || rangePenalty(preferred, band)) return null;
  return fmt("PENTRA.Roll.OutOfBands", {
    weapon: weapon.name, band: loc(PENTRA.rangeBands[band]), preferred: loc(PENTRA.rangeBands[preferred])
  });
}

/**
 * A weapon's preferred range band for this attacker: underwater it drops a band (torpedoes keep theirs; fire-based
 * weapons give null, as they don't work at all).
 */
function preferredRange(actor, weapon) {
  if (!weapon) return "melee";
  return actorUnderwater(actor) ? underwaterRange(weapon.system.range, weapon.system.underwater) : weapon.system.range;
}

/** The chase vehicle behind a target: the vehicle itself, or the one the targeted character rides in. */
function chaseVehicleOf(actor) {
  if (!actor) return null;
  return actor.type === "vehicle" ? actor : vehicleCarrying(actor);
}

/**
 * Can this attack reach its target across the chase chart? Personal weapons and bombs need Drive-by; mounted machine
 * guns reach Very Close, rockets/torpedoes Close, guided missiles Far.
 * @returns {string|null}
 */
function chaseProblem(chase, spec, target) {
  if (!target) return null;
  const weaponName = spec.unarmed || !spec.weapon ? loc("PENTRA.Unarmed") : spec.weapon.name;
  if (!chase.sameChase) return fmt("PENTRA.Chase.NotInChase", { target: target.name });
  const reach = spec.unarmed || !spec.weapon ? 0 : chaseReach(spec.weapon.system);
  if (chase.distance <= reach) return null;
  return fmt("PENTRA.Chase.OutOfReach", {
    weapon: weaponName, target: target.name,
    band: loc(`PENTRA.Chase.Band.${CHASE_BANDS[chase.distance]}`), reach: loc(`PENTRA.Chase.Band.${CHASE_BANDS[reach]}`)
  });
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
  if (spec.label) label = spec.label;
  return { attrKey, skillKey, skillValue, die, bonus, label, isResistance };
}

/**
 * Show the roll dialog. Returns null if cancelled.
 */
async function promptCheck(actor, { label, tn, isAttack, canSpendEdge, penalty, weapon, preferred, modifier = 0, note, band, size, crowd }) {
  preferred ??= weapon?.system.range;
  const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
  const content = await renderTemplate(`${TEMPLATES}/dialog/roll-dialog.hbs`, {
    tn, isAttack, canSpendEdge, penalty, modifier, note,
    band: band ?? preferred ?? "melee",
    bands: Object.fromEntries((weapon ? allowedBands(preferred) : RANGE_BANDS).map(b => [b, PENTRA.rangeBands[b]])),
    preferredLabel: weapon ? loc(PENTRA.rangeBands[preferred] ?? "") : "",
    size: String(size ?? 0),
    allies: crowd?.allies ?? 0,
    foes: crowd?.foes ?? 0,
    crowdDetected: !!crowd,
    sizeChoices: Object.fromEntries([4, 2, 1, 0, -1, -2, -4].map(n => [n, `${signed(n)}${n === (size ?? 0) && n ? ` (${loc("PENTRA.Roll.SizeAuto")})` : ""}`])),
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
 * @param {object} spec  See describeCheck. Also accepts:
 *   `skipDialog`, `options` (pre-filled dialog values), `label` (card title), `tn` (default target number),
 *   `extraModifiers` ([{label, value}] always applied, e.g. vehicle handling), `targetToken` (overrides the user's
 *   target), `collision` (a vehicle ramming: wounds count every success), and `messageMode` (e.g. "gm" to keep
 *   the card between the GM and the roller).
 */
export async function rollCheck(actor, spec) {
  const desc = describeCheck(actor, spec);
  const isAttack = spec.type === "attack";
  const isCharacter = actor.type === "character";
  const penalty = statusPenalty(actor, desc);

  // In a vehicle chase, the vehicle the attacker fires from (a mounted weapon's, or the one they ride in).
  const shooterVehicle = isAttack ? (spec.fromVehicle?.uuid ? spec.fromVehicle : vehicleCarrying(actor)) : null;

  // Default target number: the target's Evasion for attacks, otherwise the standard TN. Chase vehicles that aren't
  // on the map can be targeted from the Chase window.
  // In a chase, the chase target (picked with the crosshair in the Chase window) comes before a map target.
  const target = spec.targetToken ?? (isAttack ? chaseTargetFor(shooterVehicle) ?? singleTarget() : null);
  const targetEvasion = target?.actor?.system.evasion?.value;
  let tn = spec.tn ?? (Number.isNumeric(targetEvasion) ? targetEvasion : defaultTN());

  // Always-on modifiers: those passed in, plus -1 for firing a ranged weapon from a vehicle.
  const extra = [...(spec.extraModifiers ?? [])];
  if (isAttack && !spec.unarmed && spec.weapon?.system.category !== "melee" && !spec.fromVehicle) {
    const ride = vehicleCarrying(actor);
    if (ride) extra.push({ label: fmt("PENTRA.Vehicle.FiringFrom", { name: ride.name }), value: PENTRA.vehicleFirePenalty });
  }

  // Attacks: the measured range band and the size difference, which the dialog lets the player override.
  const isRanged = isAttack && !spec.unarmed && spec.weapon && spec.weapon.system.category !== "melee";
  const myToken = isAttack ? tokenFor(actor) : null;
  // Underwater: fire-based weapons don't work, swinging weapons fight the water (-2), and ranges drop a band.
  const underwater = isAttack && actorUnderwater(actor);
  const preferred = isAttack && spec.weapon ? preferredRange(actor, spec.weapon) : null;
  if (underwater && spec.weapon && !preferred) {
    ui.notifications.warn(fmt("PENTRA.Underwater.WeaponFails", { weapon: spec.weapon.name }));
    return null;
  }
  if (underwater && spec.weapon?.system.underwater === "swing") {
    extra.push({ label: loc("PENTRA.Underwater.SwingPenalty"), value: PENTRA.underwater.swingPenalty });
  }

  // In a chase, range comes from the lane chart; otherwise melee needs the target adjacent and ranged weapons reach
  // one band past their preferred band.
  // (A target on foot, outside any vehicle, still uses the map.)
  const targetVehicle = chaseVehicleOf(target?.actor);
  const chase = isAttack ? chaseSituation(shooterVehicle, targetVehicle) : null;
  if (isAttack) {
    const problem = chase && targetVehicle
      ? chaseProblem(chase, spec, target)
      : reachProblem(actor, { weapon: spec.weapon, unarmed: spec.unarmed, target });
    if (problem) {
      ui.notifications.warn(problem);
      return null;
    }
  }
  // Pushing the vehicle this round: weapons fired from it are at -2.
  if (chase?.shooter.pushed) extra.push({ label: loc("PENTRA.Chase.PushedPenalty"), value: PENTRA.pushFirePenalty });
  const inChase = !!chase?.sameChase;
  const autoBand = isRanged ? ((inChase ? null : measuredBand(myToken, target)) ?? preferred) : null;
  const autoSize = isAttack && target?.actor ? sizeModifier(actor.system.size, target.actor.system.size) : 0;
  const crowd = isAttack && !isRanged && !inChase ? meleeCrowd(myToken, target) : null;

  // Restrained: -2 to attack with two-handed weapons.
  if (isAttack && spec.weapon?.system.hands === 2 && actor.statuses?.has("restrained")) {
    extra.push({ label: loc("PENTRA.Status.restrained"), value: PENTRA.restrainedTwoHandedPenalty });
  }

  let opts = {
    tn, modifier: 0, advantage: 0, spendEdge: false, location: "torso", cover: 0, light: 0, aim: false, push: false,
    band: autoBand, size: autoSize, allies: crowd?.allies ?? 0, foes: crowd?.foes ?? 0, surprise: false, smoke: false, drunk: false,
    ...(spec.options ?? {})
  };
  if (!spec.skipDialog) {
    const result = await promptCheck(actor, {
      label: desc.label, tn, isAttack, penalty,
      modifier: opts.modifier, note: spec.note,
      canSpendEdge: isCharacter && actor.system.edge.value >= 2,
      weapon: spec.weapon, preferred, band: autoBand, size: autoSize, crowd
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
  for (const m of extra) {
    if (!m.value) continue;
    modifier += m.value;
    parts.push(`${m.label} ${m.value > 0 ? "+" : ""}${m.value}`);
  }
  if (isAttack) {
    const locMod = PENTRA.hitLocations[opts.location]?.modifier ?? 0;
    if (locMod) { modifier += locMod; parts.push(`${loc(PENTRA.hitLocations[opts.location].label)} ${locMod}`); }
    for (const k of ["cover", "light"]) {
      const v = Number(opts[k]) || 0;
      if (v) { modifier += v; parts.push(`${loc(PENTRA.situationalModifiers[k].options[v])} ${v}`); }
    }
    if (opts.aim) { modifier += 2; parts.push(`${loc("PENTRA.Roll.Aim")} +2`); }
    const add = (value, label) => { if (value) { modifier += value; parts.push(`${label} ${value > 0 ? "+" : ""}${value}`); } };
    if (isRanged && opts.band && RANGE_BANDS.includes(opts.band)) {
      const { range, inMelee } = rangePenalty(preferred, opts.band) ?? { range: 0, inMelee: 0 };
      add(range, `${loc("PENTRA.Roll.RangeToTarget")}: ${loc(PENTRA.rangeBands[opts.band])}`);
      add(inMelee, loc("PENTRA.Roll.FiringInMelee"));
    }
    if (!isRanged) {
      add(Math.max(Number(opts.allies) || 0, 0), loc("PENTRA.Roll.AlliesOnTarget"));
      add(-Math.max(Number(opts.foes) || 0, 0), loc("PENTRA.Roll.ExtraFoes"));
    }
    add(Number(opts.size) || 0, loc("PENTRA.Roll.Size"));
    if (opts.surprise) add(2, loc("PENTRA.Roll.Surprise"));
    if (opts.smoke) add(-2, loc("PENTRA.Roll.Smoke"));
    if (opts.drunk) add(-2, loc("PENTRA.Roll.Drunk"));
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
    if (next !== current) await actor.update({ "system.edge.value": next }, { pentraMechanic: true });
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
      profile: `${profile.wounds} (${loc(PENTRA.increments[profile.increment])})${profile.heavy ? " ×2" : ""}`,
      // Burning weapons (flamethrowers) set what they hit on fire.
      burning: !!spec.weapon?.system.burning
    };
    if (isCharacter && spec.weapon && spec.weapon.system.category === "ranged") {
      await actor.update({ "system.roundsFired": actor.system.roundsFired + 1 });
    }
  }

  // Collision: wounds equal to the number of successes, as an (every) success type.
  if (spec.collision) {
    damage = {
      collision: true,
      wounds: countWounds({ base: 0, increment: "every", tn, total: roll.total }),
      location: "torso",
      vehicleUuid: spec.collision.vehicleUuid
    };
  }

  const attrLabel = loc(desc.isResistance ? PENTRA.resistances[desc.attrKey] : PENTRA.attributes[desc.attrKey]);
  const content = await renderTemplate(`${TEMPLATES}/chat/check.hbs`, {
    label: desc.label,
    subtitle: desc.skillKey || spec.type === "language" ? `${attrLabel} d${desc.die}+${desc.bonus} · ${loc("PENTRA.Skill.label")} ${desc.skillValue}` : `d${desc.die}+${desc.bonus}`,
    rollHTML: await roll.render(),
    tn, success, isAttack: isAttack || !!spec.collision,
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
    flags: { [SYSTEM]: { type: spec.type, success, damage, tn, targetUuid: target?.document?.uuid ?? target?.uuid ?? null } }
  }, spec.messageMode ? { messageMode: spec.messageMode } : {});
}

/* -------------------------------------------------------------------------- */
/*  Damage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Apply incoming wounds to an actor: subtract the AR at the hit location, reduce Health, apply Shaken,
 * and make one collective Durability usage check for the worn armor covering the location.
 * @param {Actor} actor
 * @param {number} wounds       Wounds before armor
 * @param {string} location     Hit location key
 * @param {object} [options]
 * @param {boolean} [options.direct]  Lingering damage (burning, poison): no armor, no durability check,
 *                                    no hit-location effects
 * @param {string} [options.source]   What caused it, shown on the card
 */
export async function applyWounds(actor, wounds, location = "torso", { direct = false, source = null } = {}) {
  const sys = actor.system;
  const ar = direct ? 0 : (sys.armor?.[location] ?? 0);
  const taken = Math.max(wounds - ar, 0);
  const health = Math.max(sys.health.value - taken, 0);
  const lines = [];

  await actor.update({ "system.health.value": health }, { pentraMechanic: true });
  if (actor.type === "vehicle") return damageVehicle(actor, { wounds, ar, taken, health, direct, source });
  if (taken > 0) {
    await actor.toggleStatusEffect("shaken", { active: true });
    // Shaken lasts until the end of this character's next turn: remember when it was (re)applied.
    const combat = game.combat;
    if (combat?.started) {
      await actor.setFlag(SYSTEM, "shakenAt", { combat: combat.id, round: combat.round, turn: combat.turn });
    }
    if (location === "head") await actor.toggleStatusEffect("headWound", { active: true });
  }

  // Durability: worn armor struck at this location makes ONE usage check as a collective whole.
  // Roll the weakest piece's die against 1..(wounds before armor); if it fails, every piece drops a size.
  const armorRolls = [];
  const pieces = direct ? [] : actor.items.filter(i => i.type === "armor" && i.system.equipped
    && i.system.coverage[location] && i.system.durability > 0);
  if (wounds > 0 && pieces.length) {
    const die = Math.min(...pieces.map(i => i.system.durability));
    const roll = await new Roll(`1d${die}`).evaluate();
    armorRolls.push(roll);
    const reduced = roll.total <= wounds;
    const names = pieces.map(i => i.name).join(", ");
    if (reduced) {
      const updates = pieces.map(i => ({ _id: i.id, "system.durability": stepDie(i.system.durability, -1) }));
      await actor.updateEmbeddedDocuments("Item", updates);
      const results = updates.map(u => `${actor.items.get(u._id).name} ${u["system.durability"] ? formatDie(u["system.durability"]) : loc("PENTRA.Broken")}`);
      lines.push(fmt("PENTRA.Damage.ArmorDegraded", { names, roll: roll.total, die: formatDie(die), range: wounds, results: results.join(", ") }));
    } else {
      lines.push(fmt("PENTRA.Damage.ArmorHeld", { names, roll: roll.total, die: formatDie(die), range: wounds }));
    }
  }

  // Incapacitation
  if (health === 0 && taken > 0) {
    if (actor.type === "character") {
      await actor.toggleStatusEffect("unconscious", { active: true });
      if (!actor.system.dying.active) await actor.update({ "system.dying": { active: true, rounds: 0 } }, { pentraMechanic: true });
      lines.push(loc("PENTRA.Damage.DeathMove"));
    } else {
      await actor.toggleStatusEffect("dead", { active: true, overlay: true });
      lines.push(fmt("PENTRA.Damage.Defeated", { name: actor.name }));
    }
  }

  const content = await renderTemplate(`${TEMPLATES}/chat/damage.hbs`, {
    name: actor.name, wounds, ar, taken, health, max: sys.health.max, source,
    location: direct ? null : loc(PENTRA.hitLocations[location].label), shaken: taken > 0, lines
  });
  const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls: armorRolls });

  // Arm and leg hits that wound (and don't drop the target) call for a resistance check.
  if (!direct && taken > 0 && health > 0) await locationEffect(actor, location);
  return message;
}

/**
 * Hit location effects. Arm: Reflex check or drop a held object. Leg: Fortitude check or lose one range band of
 * movement (the Leg Wound status, until fully healed). Head wounds are handled as a status in applyWounds.
 */
async function locationEffect(actor, location) {
  const effect = { arms: { key: "reflex", fail: "PENTRA.Location.ArmFail" }, legs: { key: "fortitude", fail: "PENTRA.Location.LegFail" } }[location];
  if (!effect) return;
  const msg = await rollCheck(actor, {
    type: "resistance", key: effect.key, skipDialog: true,
    label: fmt("PENTRA.Location.CheckLabel", { location: loc(PENTRA.hitLocations[location].label), resistance: loc(PENTRA.resistances[effect.key]) })
  });
  if (!msg || msg.getFlag(SYSTEM, "success")) return;
  if (location === "legs") await actor.toggleStatusEffect("legWound", { active: true });
  return announce(actor, loc(PENTRA.hitLocations[location].label), [fmt(effect.fail, { name: actor.name })]);
}

/**
 * End-of-turn lingering damage. Burning: 1 wound unless the flames are out (remove the status). Poisoned: a
 * Fortitude check first; a success ends the poison, a failure deals 1 wound. Both ignore armor. Called once, on the active GM's client.
 */
export async function lingeringDamage(actor) {
  // Nothing more to lose at 0 Health (the dying count is already running).
  if (!actor?.system.health || actor.system.health.value <= 0 || actor.statuses.has("dead")) return;
  if (actor.statuses.has("burning")) {
    await applyWounds(actor, 1, "torso", { direct: true, source: loc("PENTRA.Status.burning") });
  }
  if (actor.statuses.has("poisoned") && actor.system.resistances && !actor.statuses.has("dead")) {
    const msg = await rollCheck(actor, {
      type: "resistance", key: "fortitude", skipDialog: true,
      label: `${loc("PENTRA.Status.poisoned")}: ${loc(PENTRA.resistances.fortitude)}`
    });
    if (!msg) return;
    if (msg.getFlag(SYSTEM, "success")) {
      // Shaking off the poison ends it.
      await actor.toggleStatusEffect("poisoned", { active: false });
      await announce(actor, loc("PENTRA.Status.poisoned"), [game.i18n.format("PENTRA.Poison.Cured", { name: actor.name })]);
    } else {
      await applyWounds(actor, 1, "torso", { direct: true, source: loc("PENTRA.Status.poisoned") });
    }
  }
}

/**
 * The vehicle half of applyWounds: its own Durability Die makes the usage check (1 to the wounds before
 * armor), and at 0 Health it's wrecked.
 */
async function damageVehicle(vehicle, { wounds, ar, taken, health, direct = false, source = null }) {
  const sys = vehicle.system;
  const lines = [];
  const rolls = [];
  const die = sys.durability.value;
  if (!direct && wounds > 0 && die > 0) {
    const roll = await new Roll(`1d${die}`).evaluate();
    rolls.push(roll);
    if (roll.total <= wounds) {
      const next = stepDie(die, -1);
      await vehicle.update({ "system.durability.value": next }, { pentraMechanic: true });
      lines.push(fmt("PENTRA.Vehicle.ArmorDegraded", { roll: roll.total, die: formatDie(die), range: wounds, result: next ? formatDie(next) : loc("PENTRA.Broken") }));
    } else {
      lines.push(fmt("PENTRA.Vehicle.ArmorHeld", { roll: roll.total, die: formatDie(die), range: wounds }));
    }
  }
  if (health === 0 && taken > 0) {
    await vehicle.toggleStatusEffect("dead", { active: true, overlay: true });
    lines.push(fmt("PENTRA.Vehicle.Wrecked", { name: vehicle.name }));
  }
  const content = await renderTemplate(`${TEMPLATES}/chat/damage.hbs`, {
    name: vehicle.name, wounds, ar, taken, health, max: sys.health.max, source, lines
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: vehicle }), content, rolls });
}

/**
 * A collision: both vehicles take the wounds, and everyone aboard either one takes half (rounded down).
 * Applies to whatever the current user owns; anything else is listed so the GM can apply it.
 */
export async function applyCollision(damage, targetActor) {
  const rammer = fromUuidSync(damage.vehicleUuid);
  const vehicles = [rammer, targetActor].filter(a => a?.type === "vehicle");
  const half = Math.floor(damage.wounds / 2);
  const crew = new Set(vehicles.flatMap(v => v.system.aboard));
  const skipped = [];
  for (const v of vehicles) {
    if (v.isOwner) await applyWounds(v, damage.wounds);
    else skipped.push(v.name);
  }
  if (half > 0) for (const person of crew) {
    if (person.isOwner) await applyWounds(person, half);
    else skipped.push(person.name);
  }
  if (skipped.length) ui.notifications.warn(fmt("PENTRA.Vehicle.CollisionSkipped", { names: skipped.join(", ") }));
}

/** Restore wounds (up to max Health). */
export async function healWounds(actor, amount) {
  const sys = actor.system;
  // Being healed ends the dying count: resolve the Death Die check first.
  if (actor.system.dying?.active) await resolveDying(actor, loc("PENTRA.Dying.ByHealing"));
  const value = Math.min(sys.health.value + amount, sys.health.max);
  await actor.update({ "system.health.value": value }, { pentraMechanic: true });
  if (value > 0 && actor.statuses.has("unconscious")) await actor.toggleStatusEffect("unconscious", { active: false });
  // A head wound's -2 lasts "until healed": clear it once Health is fully restored.
  if (value >= sys.health.max && actor.statuses.has("headWound")) await actor.toggleStatusEffect("headWound", { active: false });
  if (value >= sys.health.max && actor.statuses.has("legWound")) await actor.toggleStatusEffect("legWound", { active: false });
  return value;
}

/**
 * Treat Wounds: a Medicine check (Trauma Kit required) on the targeted token, or on the healer if nothing is
 * targeted. A success heals by Medicine rank (0–3: 1, 4–5: 2, 6: 3). Afterwards the kit makes a 1–2 usage check.
 * If the user doesn't own the patient, the chat card offers an "Apply healing" button for the owner or GM.
 */
export async function treatWounds(healer) {
  const kit = healer.items.find(i => i.type === "fieldkit" && i.system.kitType === "trauma" && i.system.usage > 0);
  if (!kit) return ui.notifications.warn(loc("PENTRA.Medicine.NeedKit"));

  const targets = Array.from(game.user.targets);
  if (targets.length > 1) return ui.notifications.warn(loc("PENTRA.Medicine.OneTarget"));
  const patientToken = targets[0] ?? null;
  const patient = patientToken?.actor ?? healer;
  const { value, max } = patient.system.health;
  if (value >= max) return ui.notifications.info(fmt("PENTRA.Medicine.FullHealth", { name: patient.name }));

  const amount = medicineHealing(healer.system.skills.medicine ?? 0);
  const msg = await rollCheck(healer, { type: "skill", key: "medicine" });
  if (!msg) return;
  const success = msg.getFlag(SYSTEM, "success");
  const title = fmt("PENTRA.Medicine.Title", { name: patient.name });

  if (!success) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: healer }),
      content: await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, { title, lines: [loc("PENTRA.Medicine.Failed")] })
    });
  } else if (patient.isOwner) {
    const health = await healWounds(patient, amount);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: healer }),
      content: await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
        title, lines: [fmt("PENTRA.Medicine.Healed", { name: patient.name, amount, health, max })]
      })
    });
  } else {
    const uuid = patientToken?.document?.uuid ?? patient.uuid;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: healer }),
      content: await renderTemplate(`${TEMPLATES}/chat/heal.hbs`, { title, amount, name: patient.name }),
      flags: { [SYSTEM]: { heal: amount, healUuid: uuid } }
    });
  }

  // The kit checks its supplies whether or not the treatment worked.
  return rollUsage({
    actor: healer, label: kit.name, die: kit.system.usage, range: 2,
    onReduce: next => kit.update({ "system.usage": next })
  });
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
    onReduce: next => actor.update({ "system.resourceDie.value": next }, { pentraMechanic: true })
  });
  return true;
}

/**
 * Sell an item to try to raise the Resource Die. Rolls repeatedly while the sale value still exceeds the die.
 */
export async function sell(actor, { label, costDie, multiplier = 1 }) {
  const value = saleValue({ costDie, multiplier });
  return raiseResourceDie(actor, { value, title: fmt("PENTRA.Sell.Label", { label }), valueLabel: loc("PENTRA.Sell.Value") });
}

/**
 * A reward (loot, payment) worth a die and multiplier, rolled against the Resource Die like a sale
 * but without the sale markdown.
 */
export async function reward(actor, { die, multiplier = 1 }) {
  return raiseResourceDie(actor, {
    value: { die, multiplier },
    title: loc("PENTRA.Reward.Title"),
    valueLabel: loc("PENTRA.Reward.Value")
  });
}

/** Ask for a reward's value, then roll it. */
export async function promptReward(actor) {
  const dice = [4, 6, 8, 10, 12].map(d => `<option value="${d}" ${d === 6 ? "selected" : ""}>d${d}</option>`).join("");
  const mults = [1, 2, 3, 4, 5, 6].map(m => `<option value="${m}">x${m}</option>`).join("");
  const result = await DialogV2.prompt({
    window: { title: loc("PENTRA.Reward.Title"), icon: "fa-solid fa-sack-dollar" },
    content: `<div class="pentra">
      <p class="hint">${fmt("PENTRA.Reward.Prompt", { die: formatDie(actor.system.resourceDie.value) })}</p>
      <div class="form-group">
        <label>${loc("PENTRA.Reward.Value")}</label>
        <div class="form-fields"><select name="die">${dice}</select><select name="multiplier">${mults}</select></div>
      </div></div>`,
    ok: {
      label: "PENTRA.Reward.Roll", icon: "fa-solid fa-dice",
      callback: (e, button) => ({ die: Number(button.form.elements.die.value), multiplier: Number(button.form.elements.multiplier.value) })
    },
    rejectClose: false
  });
  if (!result) return;
  return reward(actor, result);
}

/**
 * Roll to raise the Resource Die from something of value (a sale or a reward).
 * Value below the die: it rises on the top `multiplier` faces. Value at or above: it rises on the top two faces,
 * rolling again while the value still exceeds the new die. A depleted (0) Resource Die rises to d4 automatically.
 */
async function raiseResourceDie(actor, { value, title, valueLabel }) {
  let die = actor.system.resourceDie.value;
  const rolls = [];
  const lines = [];
  if (!die) {
    die = 4;
    lines.push(loc("PENTRA.Reward.FromZero"));
  }
  while (die < 12) {
    const threshold = saleThreshold({ saleDie: value.die, saleMultiplier: value.multiplier, resourceDie: die });
    const roll = await new Roll(`1d${die}`).evaluate();
    rolls.push(roll);
    const raised = roll.total >= threshold;
    lines.push(fmt(raised ? "PENTRA.Sell.Raised" : "PENTRA.Sell.NoChange", {
      die: formatDie(die), roll: roll.total, threshold, next: formatDie(stepDie(die, 1))
    }));
    if (!raised) break;
    die = stepDie(die, 1);
    if (value.die <= die) break;
  }
  if (die >= 12 && !rolls.length) lines.push(loc("PENTRA.Reward.AtMax"));
  await actor.update({ "system.resourceDie.value": die }, { pentraMechanic: true });
  const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
    title, subtitle: `${valueLabel}: ${formatCost(value.die, value.multiplier)}`, lines
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls });
}

/* -------------------------------------------------------------------------- */
/*  Misc character actions                                                    */
/* -------------------------------------------------------------------------- */

/** Spend 1 Edge to support an ally: roll a d6 to add to their check. */
export async function supportAlly(actor) {
  if (actor.system.edge.value < 1) return ui.notifications.warn(loc("PENTRA.Edge.NotEnough"));
  await actor.update({ "system.edge.value": actor.system.edge.value - 1 }, { pentraMechanic: true });
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
/**
 * Roll the Death Die against the rounds spent down. At or under: a scar (lower one attribute a die) and the
 * Death Die shrinks; shrinking below d4 means death.
 */
/**
 * A character dies: any dying count stops, Unconscious gives way to Dead (with the token overlay), and the
 * table is told. Safe to call more than once.
 */
export async function markDead(actor) {
  if (actor.statuses.has("dead")) return;
  if (actor.system.dying?.active) {
    await actor.update({ "system.dying": { active: false, rounds: 0 } }, { pentraMechanic: true });
  }
  if (actor.statuses.has("unconscious")) await actor.toggleStatusEffect("unconscious", { active: false });
  await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pentra chat-card death-card"><p><i class="fa-solid fa-skull"></i> <strong>${fmt("PENTRA.Death.Died", { name: foundry.utils.escapeHTML(actor.name) })}</strong></p></div>`
  });
}

async function rollDeathDie(actor, rounds, note) {
  const die = actor.system.deathDie.value;
  const speaker = ChatMessage.getSpeaker({ actor });
  if (!die) return markDead(actor);
  if (rounds <= 0) {
    const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
      title: loc("PENTRA.Trait.deathDie"), lines: [note, loc("PENTRA.Dying.NoRisk")].filter(Boolean)
    });
    return ChatMessage.create({ speaker, content });
  }
  const result = await rollUsage({
    actor, label: loc("PENTRA.Trait.deathDie"), die, range: rounds,
    note: [note, loc("PENTRA.Death.ScarNote")].filter(Boolean).join(" "),
    onReduce: next => actor.update({ "system.deathDie.value": next }, { pentraMechanic: true })
  });
  if (!result?.reduced) return;
  if (result.die === 0) return markDead(actor);
  return inflictScar(actor);
}

/** Attributes a scar can lower (anything above d12+0). */
const scarrable = actor => Object.keys(PENTRA.attributes).filter(k => actor.system.attributes[k].rank > 0);

/**
 * A scar: the player permanently lowers one attribute a die (Karma can buy it back). If no attribute can be
 * lowered, the character dies. The choice is the player's, so it waits on the sheet and a chat button.
 */
async function inflictScar(actor) {
  if (!scarrable(actor).length) {
    await announce(actor, loc("PENTRA.Death.Scar"), [fmt("PENTRA.Scar.NoAttribute", { name: actor.name })]);
    return markDead(actor);
  }
  await actor.setFlag(SYSTEM, "pendingScars", (actor.getFlag(SYSTEM, "pendingScars") ?? 0) + 1);
  const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
    title: loc("PENTRA.Death.Scar"),
    lines: [fmt("PENTRA.Scar.Choose", { name: actor.name })],
    button: { action: "take-scar", icon: "fa-solid fa-user-injured", label: loc("PENTRA.Scar.Button") }
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, flags: { [SYSTEM]: { scarUuid: actor.uuid } } });
}

/** Let the player pick which attribute a pending scar lowers. */
export async function chooseScar(actor) {
  if (!actor?.isOwner) return ui.notifications.warn(fmt("PENTRA.Damage.NotOwner", { name: actor?.name ?? "?" }));
  const pending = actor.getFlag(SYSTEM, "pendingScars") ?? 0;
  if (!pending) return ui.notifications.info(fmt("PENTRA.Scar.NonePending", { name: actor.name }));
  const keys = scarrable(actor);
  if (!keys.length) {
    await actor.unsetFlag(SYSTEM, "pendingScars");
    return inflictScar(actor);
  }
  const options = keys.map((k, i) => {
    const rank = actor.system.attributes[k].rank;
    return `<label class="checkbox"><input type="radio" name="attribute" value="${k}" ${i === 0 ? "checked" : ""}>
      ${loc(PENTRA.attributes[k])}: ${formatAttribute(rank)} → ${formatAttribute(rank - 1)}</label>`;
  }).join("");
  const key = await DialogV2.prompt({
    window: { title: fmt("PENTRA.Scar.Title", { name: actor.name }), icon: "fa-solid fa-user-injured" },
    content: `<div class="pentra scar-dialog"><p>${loc("PENTRA.Scar.Prompt")}</p>${options}</div>`,
    ok: { label: "PENTRA.Scar.Confirm", callback: (event, button) => button.form.elements.attribute.value },
    rejectClose: false
  });
  if (!key) return;
  const rank = actor.system.attributes[key].rank;
  if (rank <= 0) return;
  await actor.update({ [`system.attributes.${key}.rank`]: rank - 1 }, { pentraBypass: true });
  const scars = [...(actor.getFlag(SYSTEM, "scars") ?? []), key];
  await actor.update({ [`flags.${SYSTEM}.scars`]: scars, [`flags.${SYSTEM}.pendingScars`]: pending - 1 });
  return announce(actor, loc("PENTRA.Death.Scar"), [fmt("PENTRA.Scar.Taken", {
    name: actor.name, attribute: loc(PENTRA.attributes[key]), from: formatAttribute(rank), to: formatAttribute(rank - 1)
  })]);
}

/**
 * End a character's dying count (stabilized, healed, or combat over) and roll the Death Die against the
 * rounds counted. The caller must be able to update the actor.
 * @param {Actor} actor
 * @param {string} reason  Why the count ended, for the chat card
 */
export async function resolveDying(actor, reason) {
  const dying = actor.system.dying;
  if (!dying?.active) return;
  const rounds = dying.rounds;
  await actor.update({ "system.dying": { active: false, rounds: 0 } }, { pentraMechanic: true });
  return rollDeathDie(actor, rounds, fmt("PENTRA.Dying.Ended", { reason, rounds }));
}

/**
 * Stabilize a dying character: a Medicine check (1 action) on the targeted token. Success stops the dying count
 * and rolls the Death Die. If the user doesn't own the patient, the card offers an "Apply" button to its owner/GM.
 */
export async function stabilize(healer) {
  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) return ui.notifications.warn(loc("PENTRA.Dying.TargetOne"));
  const token = targets[0];
  const patient = token.actor;
  if (patient?.statuses.has("dead")) return ui.notifications.warn(fmt("PENTRA.Death.AlreadyDead", { name: patient.name }));
  if (!patient?.system.dying?.active) return ui.notifications.info(fmt("PENTRA.Dying.NotDying", { name: patient?.name ?? token.name }));
  // Packing wounds is hands-on: the healer must be next to the patient (when both are on the map).
  const healerToken = tokenFor(healer);
  if (healerToken && healerToken !== token && !adjacent(healerToken, token)) {
    return ui.notifications.warn(fmt("PENTRA.Dying.NotAdjacent", { healer: healer.name, name: patient.name }));
  }

  const msg = await rollCheck(healer, { type: "skill", key: "medicine" });
  if (!msg) return;
  const title = fmt("PENTRA.Dying.StabilizeTitle", { name: patient.name });
  const speaker = ChatMessage.getSpeaker({ actor: healer });
  if (!msg.getFlag(SYSTEM, "success")) {
    const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, { title, lines: [loc("PENTRA.Dying.StabilizeFailed")] });
    return ChatMessage.create({ speaker, content });
  }
  if (patient.isOwner) return resolveDying(patient, fmt("PENTRA.Dying.ByStabilize", { name: healer.name }));
  const content = await renderTemplate(`${TEMPLATES}/chat/stabilize.hbs`, { title });
  return ChatMessage.create({
    speaker, content,
    flags: { [SYSTEM]: { stabilizeUuid: token.document.uuid, stabilizedBy: healer.name } }
  });
}

/** Blaze of Glory: an automatic 12 + skill attack dealing double wounds. */
export async function blazeOfGlory(actor, weapon) {
  if (actor.statuses.has("dead")) return ui.notifications.warn(fmt("PENTRA.Death.AlreadyDead", { name: actor.name }));
  const skillKey = weapon ? weapon.system.skill : "martial_arts";
  const skill = actor.system.skills[skillKey] ?? 0;
  const total = 12 + skill;
  const target = singleTarget();
  const problem = reachProblem(actor, { weapon, unarmed: !weapon, target });
  if (problem) return ui.notifications.warn(problem);
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
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), content,
    flags: { [SYSTEM]: { type: "attack", damage, targetUuid: target?.document?.uuid ?? null } }
  });
  // After the attack resolves, the character passes away.
  await markDead(actor);
}

/* -------------------------------------------------------------------------- */
/*  Armor repair                                                              */
/* -------------------------------------------------------------------------- */

/** A Technical Kit with uses left, needed to repair armor. */
function technicalKit(actor) {
  return actor.items.find(i => i.type === "fieldkit" && i.system.kitType === "technical" && i.system.usage > 0);
}

/** After a successful repair, the Technical Kit makes a 1–2 usage check. */
function technicalKitUsage(actor, kit) {
  return rollUsage({
    actor, label: kit.name, die: kit.system.usage, range: 2,
    onReduce: next => kit.update({ "system.usage": next })
  });
}

async function announce(actor, title, lines) {
  const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, { title, lines });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
}

/**
 * Repair all worn armor as a collective whole: one Crafting check (Technical Kit required). On a success every
 * worn, unbroken piece is restored to the character's Durability Die and the kit makes a usage check.
 * A failure wastes 10 minutes but neither damages the armor nor uses up materials.
 */
export async function repairWornArmor(actor) {
  const die = actor.system.durabilityDie?.value ?? 8;
  const worn = actor.items.filter(i => i.type === "armor" && i.system.equipped);
  const pieces = worn.filter(i => i.system.durability > 0 && i.system.durability < die);
  if (!pieces.length) {
    const broken = worn.some(i => i.system.durability === 0);
    return ui.notifications.info(loc(broken ? "PENTRA.Armor.OnlyBroken" : "PENTRA.Armor.NothingToRepair"));
  }
  const kit = technicalKit(actor);
  if (!kit) return ui.notifications.warn(loc("PENTRA.Armor.NeedKit"));

  const msg = await rollCheck(actor, { type: "skill", key: "crafting" });
  if (!msg) return;
  const title = loc("PENTRA.Armor.RepairTitle");
  if (!msg.getFlag(SYSTEM, "success")) return announce(actor, title, [loc("PENTRA.Armor.RepairFailed")]);

  await actor.updateEmbeddedDocuments("Item", pieces.map(i => ({ _id: i.id, "system.durability": die })));
  await announce(actor, title, [fmt("PENTRA.Armor.Repaired", {
    names: pieces.map(i => `${i.name} ${formatDie(die)}`).join(", ")
  })]);
  return technicalKitUsage(actor, kit);
}

/**
 * Broken armor can only be fixed by salvaging another suit of identical armor: one Crafting check
 * (Technical Kit required); on a success the broken piece is restored and the donor suit is used up.
 */
export async function salvageArmor(actor, item) {
  if (item.system.durability !== 0) return ui.notifications.info(loc("PENTRA.Armor.NotBroken"));
  const donor = actor.items
    .filter(i => i.type === "armor" && i.id !== item.id && i.name === item.name)
    .sort((a, b) => Number(a.system.equipped) - Number(b.system.equipped) || (a.system.durability ?? 0) - (b.system.durability ?? 0))[0];
  if (!donor) return ui.notifications.warn(fmt("PENTRA.Armor.NeedDonor", { name: item.name }));
  const kit = technicalKit(actor);
  if (!kit) return ui.notifications.warn(loc("PENTRA.Armor.NeedKit"));

  const msg = await rollCheck(actor, { type: "skill", key: "crafting" });
  if (!msg) return;
  const title = fmt("PENTRA.Armor.SalvageTitle", { name: item.name });
  if (!msg.getFlag(SYSTEM, "success")) return announce(actor, title, [loc("PENTRA.Armor.RepairFailed")]);

  const die = actor.system.durabilityDie?.value ?? 8;
  await item.update({ "system.durability": die });
  await donor.delete();
  await announce(actor, title, [fmt("PENTRA.Armor.Salvaged", { name: item.name, die: formatDie(die) })]);
  return technicalKitUsage(actor, kit);
}

/**
 * Repair a vehicle: one Crafting check with a Technical Kit. On a success it returns to full Health (and its
 * Durability Die to maximum) and the kit makes a 1–2 usage check. A failure costs time but no materials.
 */
export async function repairVehicle(actor, vehicle) {
  const { health, durability } = vehicle.system;
  if (health.value >= health.max && durability.value >= durability.max) {
    return ui.notifications.info(fmt("PENTRA.Vehicle.NothingToRepair", { name: vehicle.name }));
  }
  const kit = technicalKit(actor);
  if (!kit) return ui.notifications.warn(loc("PENTRA.Vehicle.NeedKit"));

  const msg = await rollCheck(actor, { type: "skill", key: "crafting" });
  if (!msg) return;
  const title = fmt("PENTRA.Vehicle.RepairTitle", { name: vehicle.name });
  if (!msg.getFlag(SYSTEM, "success")) return announce(actor, title, [loc("PENTRA.Vehicle.RepairFailed")]);

  await vehicle.update({ "system.health.value": health.max, "system.durability.value": durability.max }, { pentraMechanic: true });
  await announce(actor, title, [fmt("PENTRA.Vehicle.Repaired", { name: vehicle.name, health: health.max, die: formatDie(durability.max) })]);
  return technicalKitUsage(actor, kit);
}

/* -------------------------------------------------------------------------- */
/*  Downtime                                                                  */
/* -------------------------------------------------------------------------- */

/** Short downtime: restock ammunition with a Reloading Kit (1–2, +1 per 5 rounds of combat fired). */
export async function restockAmmo(actor) {
  const kit = actor.items.find(i => i.type === "fieldkit" && i.system.kitType === "reloading" && i.system.usage > 0);
  if (!kit) return ui.notifications.warn(loc("PENTRA.Downtime.NeedReloadingKit"));
  const rounds = actor.system.roundsFired ?? 0;
  const result = await rollUsage({
    actor, label: kit.name, die: kit.system.usage, range: reloadRange(rounds),
    note: fmt("PENTRA.Kit.ReloadNote", { rounds }),
    onReduce: next => kit.update({ "system.usage": next })
  });
  if (result) await actor.update({ "system.roundsFired": 0 });
  return result;
}

/** City downtime: a day at a clinic restores the Death Die one size, up to its maximum. */
export async function visitClinic(actor) {
  const { value, max } = actor.system.deathDie;
  if (value >= max) return ui.notifications.info(fmt("PENTRA.Downtime.ClinicFull", { name: actor.name, die: formatDie(max) }));
  const next = Math.min(stepDie(value, 1), max);
  await actor.update({ "system.deathDie.value": next }, { pentraMechanic: true });
  return announce(actor, loc("PENTRA.Downtime.Clinic"), [fmt("PENTRA.Downtime.ClinicResult", { from: formatDie(value), to: formatDie(next) })]);
}

/** City downtime: a day of rest heals 2 wounds (+1 with an Extreme Luxury lifestyle). Camp rest heals 1. */
export async function rest(actor, kind) {
  let amount = kind === "camp" ? 1 : 2;
  const lines = [];
  if (kind === "city" && actor.system.lifestyle === "extremeLuxury") {
    amount += 1;
    lines.push(loc("PENTRA.Downtime.LuxuryRest"));
  }
  const health = await healWounds(actor, amount);
  lines.unshift(fmt("PENTRA.Rest.Healed", { name: actor.name, amount, value: health }));
  await announce(actor, loc(kind === "camp" ? "PENTRA.Rest.Camp" : "PENTRA.Rest.Day"), lines);
  // Sleeping: each disease gets another Fortitude check.
  for (const disease of actor.items.filter(i => i.type === "disease")) await diseaseCheck(actor, disease, "sleep");
}

/* -------------------------------------------------------------------------- */
/*  Disease                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shift a character's current pool for a trait (Health, Edge, Death/Resource/Drain Die) when something that changes
 * that trait arrives or leaves. Maximums are derived; this keeps the current value in step.
 */
export function shiftTraitPool(actor, trait, delta) {
  if (actor?.type !== "character" || !trait || !delta) return;
  const sys = actor.system;
  switch (trait) {
    case "health":
      return actor.update({ "system.health.value": Math.max(sys.health.value + delta, 0) }, { pentraMechanic: true });
    case "edge":
      return actor.update({ "system.edge.value": Math.clamp(sys.edge.value + delta, 0, PENTRA.maxEdge) }, { pentraMechanic: true });
    case "deathDie":
    case "resourceDie":
    case "drainDie": {
      const path = `system.${trait}.value`;
      return actor.update({ [path]: stepDie(foundry.utils.getProperty(actor, path), delta) }, { pentraMechanic: true });
    }
  }
}

/** The Diseased status shows while the character has any disease. */
export async function syncDiseased(actor) {
  const sick = actor.items.some(i => i.type === "disease");
  if (sick !== actor.statuses.has("diseased")) await actor.toggleStatusEffect("diseased", { active: sick });
  // A disease that lowers maximum Health (e.g. Wasting Cough) can leave current Health above it.
  const health = actor.system.health;
  if (health && Number.isNumeric(health.max) && health.value > health.max) {
    await actor.update({ "system.health.value": health.max }, { pentraMechanic: true });
  }
}

/**
 * A Fortitude check against a disease, on exposure or after sleeping. A success throws it off (the disease is
 * removed); a failure means it takes hold, or keeps its grip.
 * @param {"exposure"|"sleep"|"manual"} reason
 */
export async function diseaseCheck(actor, disease, reason = "manual") {
  const msg = await rollCheck(actor, {
    type: "resistance", key: "fortitude", skipDialog: true,
    label: `${disease.name}: ${loc(PENTRA.resistances.fortitude)}`
  });
  if (!msg) return;
  const name = disease.name;
  const effect = disease.system.summary;
  if (msg.getFlag(SYSTEM, "success")) {
    // Deleting it also clears the Diseased status (in the item's delete handler).
    await disease.delete({ pentraMechanic: true });
    return announce(actor, name, [fmt(reason === "exposure" ? "PENTRA.Disease.Resisted" : "PENTRA.Disease.Recovered", { name: actor.name, disease: name })]);
  }
  // The first time it takes hold, it also takes from the current pool (e.g. Black Lung: Death Die down a size).
  if (!disease.getFlag(SYSTEM, "applied")) {
    await disease.setFlag(SYSTEM, "applied", true);
    await shiftTraitPool(actor, disease.system.trait, disease.system.traitDelta);
  }
  await announce(actor, name, [fmt(reason === "exposure" ? "PENTRA.Disease.Infected" : "PENTRA.Disease.Lingers", { name: actor.name, disease: name, effect })]);
  return syncDiseased(actor);
}

/** City downtime: pay for a day's lifestyle with the Resource Die and remember it (it affects Socialize/rest). */
export async function payLifestyle(actor, key) {
  const lifestyle = PENTRA.lifestyles[key];
  if (!lifestyle) return;
  const label = loc(lifestyle.label);
  if (key === "street") {
    await rollUsage({ actor, label, die: 8, range: 2, note: loc("PENTRA.Lifestyle.streetNote") });
  } else if (!(await purchase(actor, { label, costDie: lifestyle.die, multiplier: 1 }))) {
    return false;
  }
  await actor.update({ "system.lifestyle": key });
  return true;
}

/** City downtime: Socialize with a social skill; Luxury lifestyles add +1/+2. */
export async function socialize(actor, skill) {
  const bonus = { luxury: 1, extremeLuxury: 2 }[actor.system.lifestyle] ?? 0;
  return rollCheck(actor, {
    type: "skill", key: skill,
    options: { modifier: bonus },
    note: loc("PENTRA.Downtime.SocializeNote")
  });
}

/* -------------------------------------------------------------------------- */
/*  Projects                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Spend a city downtime day on a project. Research comes first (skipped with blueprints), then Crafting, each
 * worked up to the project's target die. The day's skill check must succeed; then the progress die is rolled and
 * grows on its top two faces (the first day goes from nothing to d4 automatically). Reaching the target finishes
 * the phase. Every attempt costs the day.
 */
export async function workOnProject(actor, projectId) {
  const projects = foundry.utils.deepClone(actor.system._source.projects);
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  const name = project.name || loc("PENTRA.Project.Unnamed");
  const target = projectTarget(project.value);
  if (!target) return ui.notifications.warn(fmt("PENTRA.Project.NeedValue", { name }));
  if (project.phase === "done") return ui.notifications.info(fmt("PENTRA.Project.AlreadyDone", { name }));
  if (project.phase === "research" && project.blueprint) project.phase = "crafting";

  const skill = project.phase === "research" ? "research" : "crafting";
  const phaseLabel = loc(`PENTRA.Project.Phase.${project.phase}`);
  const msg = await rollCheck(actor, { type: "skill", key: skill, label: `${name}: ${phaseLabel}` });
  if (!msg) return;

  project.days += 1;
  const lines = [];
  const rolls = [];
  if (!msg.getFlag(SYSTEM, "success")) {
    lines.push(loc("PENTRA.Project.NoProgress"));
  } else if (!project.progress) {
    project.progress = nextProjectProgress(0);
    lines.push(fmt("PENTRA.Project.Started", { die: formatDie(project.progress) }));
  } else {
    const roll = await new Roll(`1d${project.progress}`).evaluate();
    rolls.push(roll);
    if (projectRollAdvances(project.progress, roll.total)) {
      const from = project.progress;
      project.progress = nextProjectProgress(from);
      lines.push(fmt("PENTRA.Project.Advanced", { roll: roll.total, from: formatDie(from), to: formatDie(project.progress) }));
    } else {
      lines.push(fmt("PENTRA.Project.Held", { roll: roll.total, die: formatDie(project.progress) }));
    }
  }

  if (project.progress >= target) {
    if (project.phase === "research") {
      project.phase = "crafting";
      project.progress = 0;
      lines.push(fmt("PENTRA.Project.ResearchDone", { name }));
    } else {
      project.phase = "done";
      lines.push(fmt("PENTRA.Project.Done", { name }));
    }
  }
  lines.push(fmt("PENTRA.Project.DayCount", { days: project.days }));

  await actor.update({ "system.projects": projects }, { pentraMechanic: true });
  const content = await renderTemplate(`${TEMPLATES}/chat/simple.hbs`, {
    title: fmt("PENTRA.Project.Title", { name }),
    subtitle: `${phaseLabel} → ${formatDie(target)}`,
    rollHTML: rolls.length ? await rolls[0].render() : null,
    lines
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls });
}
