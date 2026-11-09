/**
 * Large-scale combat (Battles tab of the Counters window). Two armies, each with an Army Strength Counter (the larger
 * force starts at 10, the other in proportion) and a leader who rolls Leadership.
 *
 * Each round:
 *  1. Clash: both leaders roll Leadership. On a success the leader chooses to block 1 damage to their army or deal 1
 *     to the other. Damage is applied once both sides are settled.
 *  2. Morale: both leaders roll Leadership again at −1 per counter lost from the starting strength. A failure breaks
 *     the army (and gives −2 from then on).
 *  If anyone broke, one more clash is fought as they escape, then the battle ends: the side that didn't run wins; if
 *  both ran, the one with more strength left. An army at 0 strength before it gets away is wiped out.
 *
 * Fortifications and fearless creatures (undead, robots) give +2. PCs supporting a side spend Edge (Support on their
 * sheet) and the GM adds the d6 in the roll dialog's Modifier box.
 */
import { rollCheck } from "../rolls.js";
import { armyCounters, armyModifiers, battleWinner, clashDamage } from "../rules.js";

const SYSTEM = "pentra-core-foundry-vtt";
const SETTING = "battles";
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

const newSide = name => ({
  name, troops: 100, leader: "", fortified: false, fearless: false,
  start: 0, strength: 0, failedMorale: false, broken: false, result: null, choice: null
});

/** All battles, from the world setting. */
export function getBattles() {
  return foundry.utils.deepClone(game.settings.get(SYSTEM, SETTING)?.list ?? []);
}

async function saveBattles(list) {
  await game.settings.set(SYSTEM, SETTING, { list });
}

export function registerBattleSetting(onChange) {
  game.settings.register(SYSTEM, SETTING, {
    scope: "world", config: false, type: Object, default: { list: [] }, onChange
  });
}

/** Load a battle, let `fn` change it, and save. */
async function withBattle(id, fn) {
  const list = getBattles();
  const battle = list.find(b => b.id === id);
  if (!battle) return;
  const after = await fn(battle);
  await saveBattles(list);
  return after?.(battle);
}

export async function addBattle() {
  const list = getBattles();
  list.push({
    id: foundry.utils.randomID(), name: loc("PENTRA.Battle.NewName"),
    // Like counters, battles start private so the GM can set them up first.
    visible: false, round: 0, phase: "setup", winner: null,
    sides: [newSide(loc("PENTRA.Battle.SideA")), newSide(loc("PENTRA.Battle.SideB"))]
  });
  await saveBattles(list);
}

export async function removeBattle(id) {
  const battle = getBattles().find(b => b.id === id);
  if (!battle) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("PENTRA.Battle.Remove") },
    content: `<p>${fmt("PENTRA.Battle.RemoveConfirm", { name: esc(battle.name) })}</p>`
  });
  if (ok) await saveBattles(getBattles().filter(b => b.id !== id));
}

/** Inline edits from the setup form. `side` is the side index for side fields, otherwise null. */
export function editBattle(id, side, field, value) {
  return withBattle(id, battle => {
    const target = side === null ? battle : battle.sides[side];
    if (!target) return;
    target[field] = value;
  });
}

/** Back to setup (keeps the armies and leaders). */
export function resetBattle(id) {
  return withBattle(id, battle => {
    Object.assign(battle, { round: 0, phase: "setup", winner: null });
    for (const s of battle.sides) Object.assign(s, { start: 0, strength: 0, failedMorale: false, broken: false, result: null, choice: null });
  });
}

/** GM correction of an army's strength (no chat). */
export function adjustStrength(id, side, delta) {
  return withBattle(id, battle => {
    const s = battle.sides[side];
    s.strength = Math.clamp(s.strength + delta, 0, Math.max(s.start, 10));
  });
}

/** Start: work out the Army Strength Counters from the troop numbers. */
export function startBattle(id) {
  return withBattle(id, battle => {
    const [a, b] = battle.sides;
    const [ca, cb] = armyCounters(a.troops, b.troops);
    if (!ca || !cb) return () => ui.notifications.warn(loc("PENTRA.Battle.NeedTroops"));
    a.start = a.strength = ca;
    b.start = b.strength = cb;
    battle.round = 1;
    battle.phase = "clash";
    return () => announce(battle, [
      fmt("PENTRA.Battle.Begins", { a: esc(a.name), b: esc(b.name) }),
      fmt("PENTRA.Battle.Strengths", { a: esc(a.name), ca, b: esc(b.name), cb })
    ]);
  });
}

/* -------------------------------------------------------------------------- */
/*  Rolling                                                                    */
/* -------------------------------------------------------------------------- */

/** The leader rolls Leadership for this phase, with the army's modifiers. */
export async function rollLeader(id, index) {
  const battle = getBattles().find(b => b.id === id);
  const side = battle?.sides[index];
  if (!side || side.result) return;
  const leader = side.leader ? await fromUuid(side.leader) : null;
  if (!leader) return ui.notifications.warn(loc("PENTRA.Battle.NoLeader"));
  const morale = battle.phase === "morale";
  const extraModifiers = armyModifiers(side, morale).map(m => ({ label: loc(`PENTRA.Battle.Mod.${m.key}`), value: m.value }));
  const msg = await rollCheck(leader, {
    type: "skill", key: "leadership", extraModifiers,
    label: `${side.name}: ${loc(morale ? "PENTRA.Battle.MoraleCheck" : "PENTRA.Battle.ClashCheck")}`,
    note: loc("PENTRA.Battle.SupportNote"),
    messageMode: battle.visible ? undefined : "gm"
  });
  if (!msg) return;
  return setResult(id, index, msg.getFlag(SYSTEM, "success") ? "success" : "fail");
}

/** Record a check result by hand (an army with no leader actor, or a roll made elsewhere). */
export function setResult(id, index, result) {
  return withBattle(id, battle => {
    const side = battle.sides[index];
    if (!side || side.result || !["clash", "escape", "morale"].includes(battle.phase)) return;
    side.result = result;
    // A failed clash check (or a success, once a choice is made) settles that side.
    return advance(battle);
  });
}

/** A successful leader chooses: block 1 damage to their army, or deal 1 to the enemy. */
export function choose(id, index, choice) {
  return withBattle(id, battle => {
    const side = battle.sides[index];
    if (side?.result !== "success" || side.choice) return;
    side.choice = choice;
    return advance(battle);
  });
}

/**
 * Move the battle on once both sides are settled for the phase. Mutates the battle and returns a callback that posts
 * to chat after it's saved.
 */
function advance(battle) {
  const [a, b] = battle.sides;
  if (battle.phase === "morale") {
    if (!a.result || !b.result) return;
    const lines = [];
    for (const s of battle.sides) {
      if (s.result === "fail") {
        s.broken = s.failedMorale = true;
        lines.push(fmt("PENTRA.Battle.Breaks", { name: esc(s.name) }));
      } else lines.push(fmt("PENTRA.Battle.Holds", { name: esc(s.name) }));
    }
    const subtitle = `${fmt("PENTRA.Battle.RoundTitle", { round: battle.round })} · ${loc("PENTRA.Battle.Phase.morale")}`;
    nextPhase(battle, a.broken || b.broken ? "escape" : "clash");
    if (battle.phase === "escape") lines.push(loc("PENTRA.Battle.EscapeRound"));
    return () => announce(battle, lines, subtitle);
  }

  // Clash (or the escape round): settled once each side failed or chose.
  const settled = s => s.result === "fail" || (s.result === "success" && s.choice);
  if (!settled(a) || !settled(b)) return;
  const [toA, toB] = clashDamage(a.choice, b.choice);
  const lines = [];
  for (const [s, dmg] of [[a, toA], [b, toB]]) {
    const did = s.result === "fail" ? loc("PENTRA.Battle.Failed") : loc(`PENTRA.Battle.Choice.${s.choice}`);
    s.strength = Math.max(s.strength - dmg, 0);
    lines.push(fmt("PENTRA.Battle.SideResult", { name: esc(s.name), did, dmg, strength: s.strength, start: s.start }));
  }
  const escaping = battle.phase === "escape";
  const wiped = a.strength <= 0 || b.strength <= 0;
  if (wiped || escaping) {
    for (const s of battle.sides) if (s.strength <= 0) lines.push(fmt("PENTRA.Battle.Wiped", { name: esc(s.name) }));
    finish(battle, lines);
  } else {
    nextPhase(battle, "morale");
  }
  return () => announce(battle, lines, fmt("PENTRA.Battle.RoundTitle", { round: battle.round }), battle.phase === "over");
}

function nextPhase(battle, phase) {
  if (phase !== "morale") battle.round += 1;
  battle.phase = phase;
  for (const s of battle.sides) Object.assign(s, { result: null, choice: null });
}

function finish(battle, lines) {
  battle.phase = "over";
  battle.winner = battleWinner(battle.sides);
  const winner = battle.sides[battle.winner];
  lines.push(winner
    ? `<strong>${fmt("PENTRA.Battle.Winner", { name: esc(winner.name) })}</strong>`
    : `<strong>${loc("PENTRA.Battle.Draw")}</strong>`);
}

/* -------------------------------------------------------------------------- */
/*  Display                                                                    */
/* -------------------------------------------------------------------------- */

/** Template data for the Battles tab. */
export function battlesContext(isGM) {
  const leaders = Object.fromEntries([["", loc("PENTRA.Battle.NoLeaderOption")], ...game.actors
    .filter(a => ["character", "npc"].includes(a.type))
    .sort((x, y) => x.name.localeCompare(y.name))
    .map(a => [a.uuid, a.name])]);
  const battles = getBattles().filter(b => isGM || b.visible).map(battle => {
    const rolling = ["clash", "escape", "morale"].includes(battle.phase);
    return {
      ...battle,
      setup: battle.phase === "setup",
      over: battle.phase === "over",
      rolling,
      phaseLabel: loc(`PENTRA.Battle.Phase.${battle.phase}`),
      isMorale: battle.phase === "morale",
      sides: battle.sides.map((s, index) => {
        const leader = s.leader ? fromUuidSync(s.leader) : null;
        const mods = armyModifiers(s, battle.phase === "morale")
          .map(m => `${loc(`PENTRA.Battle.Mod.${m.key}`)} ${m.value > 0 ? "+" : ""}${m.value}`);
        return {
          ...s, index,
          leaderName: leader?.name ?? loc("PENTRA.Battle.NoLeaderOption"),
          hasLeader: !!leader,
          percent: s.start ? Math.round(100 * s.strength / s.start) : 0,
          mods: mods.join(", "),
          needsRoll: rolling && !s.result,
          needsChoice: rolling && battle.phase !== "morale" && s.result === "success" && !s.choice,
          resultLabel: s.result ? loc(s.result === "success" ? "PENTRA.Battle.Success" : "PENTRA.Battle.Failed") : "",
          choiceLabel: s.choice ? loc(`PENTRA.Battle.Choice.${s.choice}`) : "",
          winner: battle.phase === "over" && battle.winner === index
        };
      })
    };
  });
  return { battles, leaders };
}

/** Post a battle update: to everyone for public battles, whispered to the GM for private ones. */
async function announce(battle, lines, subtitle = "", ended = false) {
  const content = `<div class="pentra chat-card battle-card ${ended ? "ended" : ""}">
    <header class="card-header"><h3><i class="fa-solid fa-chess-rook"></i> ${esc(battle.name)}</h3>
      <span class="subtitle">${subtitle}${battle.visible ? "" : ` <i class="fa-solid fa-eye-slash"></i> ${loc("PENTRA.Counter.Private")}`}</span></header>
    <ul class="notes">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
  </div>`;
  const data = { content, speaker: { alias: loc("PENTRA.Battle.Title") } };
  if (!battle.visible) data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  return ChatMessage.create(data);
}
