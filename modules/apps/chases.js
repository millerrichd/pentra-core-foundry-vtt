/**
 * Vehicle chases (the Chase window): the abstract swim-lane range band chart.
 *
 * The GM drops vehicle actors onto a chase. The slowest is the anchor and sits on the middle row (Impact / Drive-by /
 * Fly-by); everyone else is placed above or below it, facing Escape (top) or Escape (bottom). Each round every vehicle
 * rolls its initiative die and gets its speed class in movement:
 *  - Move: one band along its facing (when the anchor moves, everyone else shifts the other way).
 *  - Turn: 1 movement to face the other way.
 *  - Push (once a round): 1 movement and a handling check: a success moves 2 bands, a failure doesn't move at all.
 *    Weapons fired from a pushed vehicle are at -2 this round.
 * Reaching Escape escapes the anchor. Flying vehicles must use at least 1 movement a round.
 *
 * Several chases can run at once: drag a vehicle from one chase's lane onto another's, or split it off into a new
 * chase. Owners move their own vehicles; their clicks are carried out by the GM's client.
 */
import * as Vehicles from "../vehicles.js";
import { CHASE_BANDS, CHASE_ESCAPE, chaseMove, nextInitiativeDie, slowestVehicle } from "../rules.js";
import { CHASE_SETTING, getChases, saveChases, getChaseTarget, setChaseTarget, pseudoTarget } from "./chase-state.js";

const SYSTEM = "pentra-core-foundry-vtt";
const SOCKET = `system.${SYSTEM}`;
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
export const CHASE_DRAG = "PentraChaseVehicle";

export function registerChaseSetting(onChange) {
  game.settings.register(SYSTEM, CHASE_SETTING, {
    scope: "world", config: false, type: Object, default: { list: [] }, onChange
  });
}

export function registerChaseSocket() {
  game.socket.on(SOCKET, request => {
    if (request?.scope === "chase") return handleRequest(request);
  });
}

/* -------------------------------------------------------------------------- */
/*  GM relay                                                                   */
/* -------------------------------------------------------------------------- */

/** Owner actions (move, turn, push) run on the active GM's client, which saves the world setting. */
function request(action, payload) {
  const data = { scope: "chase", action, userId: game.user.id, ...payload };
  if (game.users.activeGM?.isSelf) return handleRequest(data);
  if (!game.users.activeGM) return ui.notifications.warn(loc("PENTRA.Chase.NoGM"));
  game.socket.emit(SOCKET, data);
}

async function handleRequest({ action, userId, chaseId, uuid, success }) {
  if (!game.users.activeGM?.isSelf) return;
  const user = game.users.get(userId);
  const vehicle = fromUuidSync(uuid);
  if (!user || vehicle?.type !== "vehicle" || !vehicle.testUserPermission(user, "OWNER")) return;
  return updateChase(chaseId, chase => {
    // Players act on their own vehicle's turn; the GM can act for anyone at any time.
    if (!user.isGM && chase.current !== uuid) return;
    switch (action) {
      case "move": return stepVehicle(chase, uuid, "move");
      case "turn": return stepVehicle(chase, uuid, "turn");
      case "push": return stepVehicle(chase, uuid, "push", success);
      case "endTurn": if (chase.current === uuid) advanceTurn(chase); return;
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  Turn order                                                                 */
/* -------------------------------------------------------------------------- */

/** Highest initiative first; ties go to the players' vehicles (as in the rulebook's example). */
function byInitiative(a, b) {
  const player = v => Number(!!fromUuidSync(v.uuid)?.hasPlayerOwner);
  return (b.init ?? -1) - (a.init ?? -1) || player(b) - player(a);
}

/** Vehicles still in the chase, in turn order. */
const turnOrder = chase => chase.vehicles.filter(v => !v.escaped && v.init !== null && fromUuidSync(v.uuid)).sort(byInitiative);

/** Pass the turn to the next vehicle in initiative order; after the last, the round is over. */
function advanceTurn(chase) {
  const all = chase.vehicles.filter(v => v.init !== null).sort(byInitiative);
  const i = all.findIndex(v => v.uuid === chase.current);
  const next = all.slice(i + 1).find(v => !v.escaped && fromUuidSync(v.uuid));
  chase.current = next?.uuid ?? null;
}

/* -------------------------------------------------------------------------- */
/*  State changes (GM)                                                         */
/* -------------------------------------------------------------------------- */

/** Load a chase, let `fn` change it (it may return a callback to run after saving), and save. */
async function updateChase(id, fn) {
  const list = getChases();
  const chase = list.find(c => c.id === id);
  if (!chase) return;
  const after = await fn(chase, list);
  await saveChases(list);
  return after?.();
}

const speedOf = uuid => fromUuidSync(uuid)?.system.speedClass ?? 0;

function newChase(name) {
  return { id: foundry.utils.randomID(), name: name ?? loc("PENTRA.Chase.NewName"), round: 0, anchor: null, anchorSet: false, vehicles: [] };
}

/** Make `uuid` the anchor: it moves to row 0 and everyone else keeps their place relative to it. */
function setAnchor(chase, uuid) {
  const entry = chase.vehicles.find(v => v.uuid === uuid);
  if (!entry) return;
  const offset = entry.pos;
  for (const v of chase.vehicles) v.pos = Math.max(Math.min(v.pos - offset, CHASE_ESCAPE), -CHASE_ESCAPE);
  chase.anchor = uuid;
}

/** Until the GM picks one, the slowest vehicle still in the chase is the anchor. */
function autoAnchor(chase) {
  const live = chase.vehicles.filter(v => !v.escaped);
  if (chase.anchorSet && live.some(v => v.uuid === chase.anchor)) return;
  chase.anchorSet = false;
  const slowest = slowestVehicle(live.map(v => ({ uuid: v.uuid, speedClass: speedOf(v.uuid) })));
  if (slowest) setAnchor(chase, slowest);
  else chase.anchor = null;
}

function entryFor(vehicle, pos = 0) {
  return {
    uuid: vehicle.uuid, pos, facing: "up", visible: vehicle.hasPlayerOwner,
    moves: 0, used: 0, pushed: false, escaped: false, init: null, die: vehicle.system.initiativeDie?.value ?? 6
  };
}

/** Pull a vehicle out of whatever chase it's in (re-anchoring that chase). Returns its entry. */
function detach(list, uuid) {
  for (const chase of list) {
    const i = chase.vehicles.findIndex(v => v.uuid === uuid);
    if (i < 0) continue;
    const [entry] = chase.vehicles.splice(i, 1);
    if (chase.anchor === uuid) chase.anchorSet = false;
    autoAnchor(chase);
    return entry;
  }
  return null;
}

/** Add a vehicle to a chase at a row, taking it out of any other chase. */
export async function addVehicle(chaseId, vehicle, pos = 0) {
  if (!game.user.isGM || vehicle?.type !== "vehicle") return;
  const list = getChases();
  const chase = list.find(c => c.id === chaseId);
  if (!chase) return;
  const entry = detach(list, vehicle.uuid) ?? entryFor(vehicle);
  Object.assign(entry, { pos: chase.vehicles.length ? pos : 0, escaped: false });
  chase.vehicles.push(entry);
  autoAnchor(chase);
  await saveChases(list);
}

/** Drag a vehicle to another row (GM). Dragging the anchor moves everyone else instead. */
export function placeVehicle(chaseId, uuid, pos) {
  return updateChase(chaseId, chase => {
    const entry = chase.vehicles.find(v => v.uuid === uuid);
    if (!entry) return;
    entry.escaped = Math.abs(pos) >= CHASE_ESCAPE && uuid !== chase.anchor;
    if (uuid === chase.anchor) {
      for (const v of chase.vehicles) if (v.uuid !== uuid) v.pos = Math.max(Math.min(v.pos - pos, CHASE_ESCAPE), -CHASE_ESCAPE);
    } else entry.pos = pos;
  });
}

/** Move a vehicle to another chase (dragged onto it), or to a brand new chase. */
export async function transferVehicle(uuid, toChaseId = null, pos = 0) {
  if (!game.user.isGM) return;
  const list = getChases();
  const entry = detach(list, uuid);
  if (!entry) return;
  let chase = list.find(c => c.id === toChaseId);
  if (!chase) {
    chase = newChase(fmt("PENTRA.Chase.SplitName", { name: fromUuidSync(uuid)?.name ?? "?" }));
    // A split-off chase picks up where the old one was.
    chase.round = Math.max(...list.map(c => c.round), 0);
    list.push(chase);
  }
  Object.assign(entry, { pos: chase.vehicles.length ? pos : 0, escaped: false });
  chase.vehicles.push(entry);
  autoAnchor(chase);
  await saveChases(list);
}

export async function addChase() {
  const list = getChases();
  list.push(newChase());
  await saveChases(list);
}

export async function removeChase(id) {
  const chase = getChases().find(c => c.id === id);
  if (!chase) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("PENTRA.Chase.Remove") },
    content: `<p>${fmt("PENTRA.Chase.RemoveConfirm", { name: esc(chase.name) })}</p>`
  });
  if (ok) await saveChases(getChases().filter(c => c.id !== id));
}

export function renameChase(id, name) {
  return updateChase(id, chase => { chase.name = name; });
}

export function removeVehicle(chaseId, uuid) {
  return updateChase(chaseId, (chase, list) => { detach(list, uuid); });
}

export function chooseAnchor(chaseId, uuid) {
  return updateChase(chaseId, chase => {
    setAnchor(chase, uuid);
    chase.anchorSet = true;
  });
}

export function toggleVisible(chaseId, uuid) {
  return updateChase(chaseId, chase => {
    const v = chase.vehicles.find(e => e.uuid === uuid);
    if (v) v.visible = !v.visible;
  });
}

/** GM: flip facing without spending movement (setting up), or bring an escaped vehicle back in at Near Escape. */
export function gmFlip(chaseId, uuid) {
  return updateChase(chaseId, chase => {
    const v = chase.vehicles.find(e => e.uuid === uuid);
    if (v) v.facing = v.facing === "up" ? "down" : "up";
  });
}

export function rejoin(chaseId, uuid) {
  return updateChase(chaseId, chase => {
    const v = chase.vehicles.find(e => e.uuid === uuid);
    if (!v) return;
    v.escaped = false;
    v.pos = Math.sign(v.pos || 1) * (CHASE_ESCAPE - 1);
  });
}

/**
 * New round: warn about flying vehicles that didn't move, roll everyone's initiative die (a 1 drops it, a max raises
 * it) and refresh movement to the speed class.
 */
export async function newRound(chaseId) {
  const chase = getChases().find(c => c.id === chaseId);
  if (!chase || !game.user.isGM) return;
  const live = chase.vehicles.filter(v => !v.escaped && fromUuidSync(v.uuid));
  const lines = [];
  if (chase.round > 0) {
    for (const v of live) {
      const actor = fromUuidSync(v.uuid);
      if (actor.system.category === "air" && !v.used) lines.push(fmt("PENTRA.Chase.MustFly", { name: esc(actor.name) }));
    }
  }
  const rolls = [];
  const results = {};
  for (const v of live) {
    const actor = fromUuidSync(v.uuid);
    const roll = await new Roll(`1d${v.die}`).evaluate();
    rolls.push(roll);
    const next = nextInitiativeDie(v.die, roll.total);
    results[v.uuid] = { init: roll.total, die: next };
    const shift = next !== v.die ? ` → d${next}` : "";
    lines.push(`${esc(actor.name)}: <strong>${roll.total}</strong> (d${v.die}${shift}) · ${fmt("PENTRA.Chase.MovesLabel", { n: actor.system.speedClass })}`);
  }
  await updateChase(chaseId, c => {
    c.round += 1;
    for (const v of c.vehicles) {
      const r = results[v.uuid];
      if (!r) continue;
      Object.assign(v, { init: r.init, die: r.die, moves: fromUuidSync(v.uuid)?.system.speedClass ?? 0, used: 0, pushed: false });
    }
    c.current = turnOrder(c)[0]?.uuid ?? null;
    chase.round = c.round;
    chase.current = c.current;
  });
  const first = fromUuidSync(chase.current);
  if (first) lines.push(`<strong>${fmt("PENTRA.Chase.TurnOf", { name: esc(first.name) })}</strong>`);
  return announce(chase, lines, fmt("PENTRA.Chase.RoundTitle", { round: chase.round }), rolls, !live.some(v => v.visible));
}

/* -------------------------------------------------------------------------- */
/*  Owner actions: move, turn, push                                            */
/* -------------------------------------------------------------------------- */

/** Spend movement on the chase (runs on the GM's client). Returns a callback that posts any escapes. */
function stepVehicle(chase, uuid, kind, success = false) {
  const v = chase.vehicles.find(e => e.uuid === uuid);
  if (!v || v.escaped || v.moves < 1) return;
  if (kind === "push" && v.pushed) return;
  v.moves -= 1;
  v.used += 1;
  let escaped = [];
  if (kind === "turn") v.facing = v.facing === "up" ? "down" : "up";
  else if (kind === "move") escaped = chaseMove(chase.vehicles, chase.anchor, uuid, 1);
  else if (kind === "push") {
    v.pushed = true;
    if (success) escaped = chaseMove(chase.vehicles, chase.anchor, uuid, 2);
  }
  // A vehicle that escapes on its own turn is done.
  if (escaped.includes(chase.current)) advanceTurn(chase);
  if (!escaped.length) return;
  const anchorName = fromUuidSync(chase.anchor)?.name ?? "?";
  const lines = escaped.map(e => fmt("PENTRA.Chase.Escapes", { name: esc(fromUuidSync(e)?.name ?? "?"), anchor: esc(anchorName) }));
  const privately = !escaped.some(e => chase.vehicles.find(x => x.uuid === e)?.visible);
  return () => announce(chase, lines, "", [], privately);
}

/** Can this user act for the vehicle in this chase right now? */
function canAct(chaseId, uuid, { push = false } = {}) {
  const chase = getChases().find(c => c.id === chaseId);
  const v = chase?.vehicles.find(e => e.uuid === uuid);
  const vehicle = fromUuidSync(uuid);
  if (!v || !vehicle?.isOwner) return null;
  if (v.escaped) return null;
  if (!game.user.isGM && chase.current !== uuid) return ui.notifications.warn(fmt("PENTRA.Chase.NotYourTurn", { name: vehicle.name })), null;
  if (v.moves < 1) return ui.notifications.warn(fmt("PENTRA.Chase.NoMoves", { name: vehicle.name })), null;
  if (push && v.pushed) return ui.notifications.warn(fmt("PENTRA.Chase.AlreadyPushed", { name: vehicle.name })), null;
  return vehicle;
}

export function move(chaseId, uuid) {
  if (canAct(chaseId, uuid)) return request("move", { chaseId, uuid });
}

export function turn(chaseId, uuid) {
  if (canAct(chaseId, uuid)) return request("turn", { chaseId, uuid });
}

/** Push: the driver's handling check, then 2 bands on a success or none on a failure (1 movement either way). */
export async function push(chaseId, uuid, { skipDialog = false } = {}) {
  const vehicle = canAct(chaseId, uuid, { push: true });
  if (!vehicle) return;
  const msg = await Vehicles.driveCheck(vehicle, "push", { skipDialog });
  if (!msg) return;
  return request("push", { chaseId, uuid, success: !!msg.getFlag(SYSTEM, "success") });
}

/** End this vehicle's turn (movement it didn't use is lost) and pass to the next in initiative. */
export function endTurn(chaseId, uuid) {
  const chase = getChases().find(c => c.id === chaseId);
  if (chase?.current !== uuid || !fromUuidSync(uuid)?.isOwner) return;
  return request("endTurn", { chaseId, uuid });
}

/**
 * Ram (on this vehicle's turn): a vehicle sharing its Impact / Drive-by row. The chase target if it's there,
 * the only one if there's one, otherwise ask which.
 */
export async function ram(chaseId, uuid, { skipDialog = false } = {}) {
  const chase = getChases().find(c => c.id === chaseId);
  const me = chase?.vehicles.find(v => v.uuid === uuid);
  const vehicle = fromUuidSync(uuid);
  if (!me || me.escaped || !vehicle?.isOwner) return;
  if (chase.current !== uuid) return ui.notifications.warn(fmt("PENTRA.Chase.NotYourTurn", { name: vehicle.name }));
  const beside = ramTargets(chase, me);
  if (!beside.length) return ui.notifications.warn(fmt("PENTRA.Chase.NoneToRam", { name: vehicle.name }));
  let targetUuid = beside.includes(getChaseTarget()) ? getChaseTarget() : beside.length === 1 ? beside[0] : null;
  if (!targetUuid) {
    const options = beside.map(u => `<option value="${u}">${esc(fromUuidSync(u)?.name)}</option>`).join("");
    targetUuid = await foundry.applications.api.DialogV2.prompt({
      window: { title: fmt("PENTRA.Chase.RamTitle", { name: vehicle.name }) },
      content: `<div class="form-group"><label>${loc("PENTRA.Chase.RamWho")}</label><select name="who">${options}</select></div>`,
      ok: { label: "PENTRA.Chase.Ram", icon: "fa-solid fa-car-burst", callback: (event, button) => button.form.elements.who.value },
      rejectClose: false
    });
    if (!targetUuid) return;
  }
  return Vehicles.collide(vehicle, { skipDialog, target: pseudoTarget(fromUuidSync(targetUuid)) });
}

/** Vehicles in the same row as this one (the only ones it can ram). */
function ramTargets(chase, me) {
  return chase.vehicles.filter(v => v.uuid !== me.uuid && !v.escaped && v.pos === me.pos && fromUuidSync(v.uuid)).map(v => v.uuid);
}

export const target = uuid => setChaseTarget(uuid);

/* -------------------------------------------------------------------------- */
/*  Display                                                                    */
/* -------------------------------------------------------------------------- */

const ROWS = Array.from({ length: CHASE_ESCAPE * 2 + 1 }, (_, i) => CHASE_ESCAPE - i);

function bandLabel(pos) {
  const band = loc(`PENTRA.Chase.Band.${CHASE_BANDS[Math.abs(pos)]}`);
  if (!pos) return band;
  return `${band} (${loc(pos > 0 ? "PENTRA.Chase.Top" : "PENTRA.Chase.Bottom")})`;
}

/** Template data for the Chase window. */
export function chasesContext(isGM) {
  const myTarget = getChaseTarget();
  const chases = getChases().map(chase => {
    const entries = chase.vehicles
      .map(v => ({ v, actor: fromUuidSync(v.uuid) }))
      .filter(({ v, actor }) => actor && (isGM || v.visible || actor.isOwner))
      .map(({ v, actor }) => {
        const owner = actor.isOwner;
        const current = chase.round > 0 && chase.current === v.uuid;
        // Owners act on their own turn; the GM can move anyone at any time.
        const live = !v.escaped && chase.round > 0 && (isGM || current);
        return {
          ...v,
          name: actor.name,
          img: actor.img,
          driver: actor.system.driver?.name ?? "",
          isAnchor: v.uuid === chase.anchor,
          band: v.escaped ? loc("PENTRA.Chase.Escaped") : bandLabel(v.pos),
          facingIcon: v.facing === "up" ? "fa-arrow-up" : "fa-arrow-down",
          speed: actor.system.speedClass,
          pips: Array.from({ length: Math.max(actor.system.speedClass, v.moves) }, (_, i) => i < v.moves),
          canMove: owner && live && v.moves > 0,
          canPush: owner && live && v.moves > 0 && !v.pushed,
          targeted: myTarget === v.uuid,
          current,
          canEnd: current && owner,
          canRam: current && owner && !v.escaped && ramTargets(chase, v).length > 0,
          // Health: the GM and the vehicle's owners see the numbers.
          showHealth: isGM || owner,
          health: actor.system.health.value,
          healthMax: actor.system.health.max,
          healthPercent: Math.round(100 * actor.system.health.value / Math.max(actor.system.health.max, 1)),
          wrecked: actor.system.health.value <= 0,
          hurt: actor.system.health.value < actor.system.health.max,
          owner,
          isPlayer: actor.hasPlayerOwner
        };
      });
    if (!isGM && !entries.length) return null;
    const order = [...entries].sort(byInitiative);
    const rows = ROWS.map(pos => ({
      pos,
      label: bandLabel(pos),
      escape: Math.abs(pos) === CHASE_ESCAPE,
      center: pos === 0,
      chips: entries.filter(e => !e.escaped && e.pos === pos)
    }));
    return {
      ...chase, rows, order, escaped: entries.filter(e => e.escaped), setup: chase.round === 0,
      roundOver: chase.round > 0 && !chase.vehicles.some(v => v.uuid === chase.current && !v.escaped)
    };
  }).filter(Boolean);
  return { chases };
}

/** Post a chase update: whispered to the GM when nothing involved is public. */
async function announce(chase, lines, subtitle = "", rolls = [], privately = false) {
  const content = `<div class="pentra chat-card chase-card">
    <header class="card-header"><h3><i class="fa-solid fa-car-burst"></i> ${esc(chase.name)}</h3>
      <span class="subtitle">${subtitle}${privately ? ` <i class="fa-solid fa-eye-slash"></i> ${loc("PENTRA.Counter.Private")}` : ""}</span></header>
    <ul class="notes">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
  </div>`;
  const data = { content, rolls, speaker: { alias: loc("PENTRA.Chase.Title") } };
  if (privately) data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  return ChatMessage.create(data);
}
