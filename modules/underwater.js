/**
 * Underwater combat: a flag the GM sets on the whole encounter (the water button in the Combat Tracker header).
 * While it's on:
 *  - Weapons' preferred range bands drop one band (melee stays melee); torpedoes keep theirs; fire-based weapons
 *    (missiles, rockets, flamethrowers) don't work. Swinging weapons (swords, clubs, axes) are at -2.
 *  - Swimming: at most Very Close (Close as a run) in a round.
 *  - Breath: after 30 seconds (5 rounds) without air, a breath usage check at the end of each turn, from d6. When it
 *    runs out the character is Drowning (-2 to everything but Athletics) and each turn makes a usage check with the
 *    Death Die until it runs out, and they die. A SCUBA kit with air left means no breath checks; Surface resets it.
 */
import { BREATH } from "./rules.js";
import { rollUsage, markDead } from "./rolls.js";

const SYSTEM = "pentra-core-foundry-vtt";
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Is this combat (default: the current one) underwater? */
export function isUnderwater(combat = game.combat) {
  return !!combat?.getFlag(SYSTEM, "underwater");
}

/** Is this actor fighting underwater (in the current combat, which is flagged underwater)? */
export function actorUnderwater(actor) {
  const combat = game.combat;
  if (!actor || !isUnderwater(combat)) return false;
  return combat.combatants.some(c => c.actor === actor || c.actor?.uuid === actor.uuid || (!actor.isToken && c.actorId === actor.id));
}

/** GM: switch the current encounter in or out of the water. */
export async function toggleUnderwater(combat = game.combat) {
  if (!game.user.isGM || !combat) return;
  const on = !isUnderwater(combat);
  await combat.setFlag(SYSTEM, "underwater", on);
  // Out of the water: everyone breathes again.
  if (!on) {
    for (const actor of new Set(combat.combatants.map(c => c.actor).filter(Boolean))) {
      if (actor.getFlag(SYSTEM, "breath")) await actor.unsetFlag(SYSTEM, "breath");
      if (actor.statuses.has("drowning")) await actor.toggleStatusEffect("drowning", { active: false });
    }
  }
  return ChatMessage.create({
    speaker: { alias: loc("PENTRA.Underwater.Title") },
    content: `<div class="pentra chat-card underwater-card"><p><i class="fa-solid fa-water"></i> ${loc(on ? "PENTRA.Underwater.On" : "PENTRA.Underwater.Off")}</p></div>`
  });
}

/** The Combat Tracker header: the GM's toggle, and a banner for everyone while it's on. */
export function onRenderCombatTrackerUnderwater(app, html) {
  const combat = app.viewed;
  const header = html.querySelector(".combat-tracker-header");
  if (!combat || !header || header.querySelector(".pentra-underwater")) return;
  const on = isUnderwater(combat);
  if (!game.user.isGM && !on) return;
  const el = document.createElement(game.user.isGM ? "button" : "div");
  el.className = `pentra-underwater ${on ? "active" : ""}`;
  el.innerHTML = `<i class="fa-solid fa-water" inert></i> <span>${loc(on ? "PENTRA.Underwater.Banner" : "PENTRA.Underwater.Toggle")}</span>`;
  if (game.user.isGM) {
    el.type = "button";
    el.dataset.tooltip = loc("PENTRA.Underwater.ToggleHint");
    el.addEventListener("click", () => toggleUnderwater(combat));
  }
  header.append(el);
}

/* -------------------------------------------------------------------------- */
/*  Breath                                                                     */
/* -------------------------------------------------------------------------- */

/** A SCUBA kit with air left (usage die above 0) means breathing normally. */
const scubaKit = actor => actor.items.find(i => i.type === "fieldkit" && i.system.kitType === "scuba" && i.system.usage > 0);

/**
 * Does this actor need air at all? Extension point: a module returns false from
 * `Hooks.call("pentraNeedsAir", actor)` for someone who doesn't breathe, or breathes water (no breath checks).
 */
const needsAir = actor => Hooks.call("pentraNeedsAir", actor) !== false;

/** This actor's breath in this combat: rounds under, the breath die, and (NPCs) the drowning die. */
export function breathState(actor, combat = game.combat) {
  const flag = actor.getFlag(SYSTEM, "breath");
  if (flag?.combat === combat?.id) return flag;
  return { combat: combat?.id ?? null, rounds: 0, die: BREATH.die, drownDie: null };
}

/**
 * End of a combatant's turn underwater (run by the active GM): count the round; after 30 seconds roll the breath
 * die; once it's out, they're drowning and roll the Death Die instead, dying when that runs out.
 */
export async function breathCheck(actor, combat) {
  if (!isUnderwater(combat) || !actor || actor.type === "vehicle" || actor.statuses.has("dead")) return;
  if (scubaKit(actor) || !needsAir(actor)) return;
  const state = breathState(actor, combat);
  state.rounds += 1;
  const save = () => actor.setFlag(SYSTEM, "breath", state);
  if (state.rounds <= BREATH.holdRounds) return save();

  // Holding their breath: the breath die shrinks on a 1–2; at 0 they start drowning.
  if (state.die > 0) {
    const result = await rollUsage({
      actor, label: loc("PENTRA.Underwater.Breath"), die: state.die, range: 2,
      note: loc("PENTRA.Underwater.BreathNote")
    });
    state.die = result?.die ?? 0;
    await save();
    if (state.die === 0) {
      await actor.toggleStatusEffect("drowning", { active: true });
      return announce(actor, fmt("PENTRA.Underwater.StartsDrowning", { name: esc(actor.name) }));
    }
    return;
  }

  // Drowning: a usage check with the Death Die (NPCs, who have none, use a d6 drowning die) until it runs out.
  const isCharacter = actor.type === "character";
  const die = isCharacter ? actor.system.deathDie.value : (state.drownDie ?? BREATH.die);
  if (!die) return markDead(actor);
  const result = await rollUsage({
    actor, label: loc(isCharacter ? "PENTRA.Trait.deathDie" : "PENTRA.Underwater.DrownDie"), die, range: 2,
    note: loc("PENTRA.Underwater.DrowningNote"),
    onReduce: next => isCharacter ? actor.update({ "system.deathDie.value": next }, { pentraMechanic: true }) : null
  });
  const next = result?.die ?? 0;
  if (!isCharacter) {
    state.drownDie = next;
    await save();
  }
  if (next === 0) return markDead(actor);
}

/** Surface for a breath (or get air some other way): breath resets and drowning ends. */
export async function surface(actor) {
  if (!actor?.isOwner) return;
  await actor.unsetFlag(SYSTEM, "breath");
  if (actor.statuses.has("drowning")) await actor.toggleStatusEffect("drowning", { active: false });
  return announce(actor, fmt("PENTRA.Underwater.Surfaced", { name: esc(actor.name) }));
}

/** Breath readout for the character sheet (null when not underwater). */
export function breathContext(actor) {
  if (!actorUnderwater(actor) || actor.type === "vehicle" || !needsAir(actor)) return null;
  const state = breathState(actor);
  const scuba = scubaKit(actor);
  const left = Math.max(BREATH.holdRounds - state.rounds, 0);
  let status;
  if (scuba) status = fmt("PENTRA.Underwater.OnScuba", { kit: scuba.name, die: `d${scuba.system.usage}` });
  else if (actor.statuses.has("drowning")) status = loc("PENTRA.Underwater.Drowning");
  else if (left > 0) status = fmt("PENTRA.Underwater.Holding", { n: left });
  else status = fmt("PENTRA.Underwater.BreathDie", { die: `d${state.die}` });
  return { status, drowning: actor.statuses.has("drowning"), canSurface: !scuba && (state.rounds > 0 || actor.statuses.has("drowning")) };
}

function announce(actor, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pentra chat-card underwater-card"><p><i class="fa-solid fa-water"></i> ${text}</p></div>`
  });
}

