/**
 * Chase state, kept apart from the chase window so the roll code can ask "is this vehicle in a chase?" without
 * importing the UI. Chases live in a world setting:
 *   { list: [{ id, name, round, anchor, anchorSet, vehicles: [{ uuid, pos, facing, visible, moves, used, pushed,
 *     escaped, init, die }] }] }
 * `pos` runs from +6 (Escape, top) to -6 (Escape, bottom); the anchor is always at 0.
 */
import { chaseDistance } from "../rules.js";

const SYSTEM = "pentra-core-foundry-vtt";
export const CHASE_SETTING = "chases";

export function getChases() {
  return foundry.utils.deepClone(game.settings.get(SYSTEM, CHASE_SETTING)?.list ?? []);
}

export function saveChases(list) {
  return game.settings.set(SYSTEM, CHASE_SETTING, { list });
}

/** The chase a vehicle is in (and its entry), if it hasn't escaped. */
export function chaseOf(vehicleUuid) {
  if (!vehicleUuid) return null;
  for (const chase of getChases()) {
    const entry = chase.vehicles.find(v => v.uuid === vehicleUuid);
    if (entry && !entry.escaped) return { chase, entry };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Chase targets (this user only)                                             */
/* -------------------------------------------------------------------------- */

/** Chase vehicles usually aren't tokens on the map, so each user can pick a chase target from the chase window. */
let chaseTarget = null;

export const getChaseTarget = () => chaseTarget;
export function setChaseTarget(uuid) {
  chaseTarget = chaseTarget === uuid ? null : uuid;
  return chaseTarget;
}

/** A token-like stand-in for a targeted chase vehicle, so attacks and rams can use it like a map target. */
export function pseudoTarget(actor) {
  return actor ? { actor, name: actor.name, document: { uuid: actor.uuid } } : null;
}

/** The chase target to use for a shooter in a vehicle, if both are in the same chase. */
export function chaseTargetFor(shooterVehicle) {
  if (!chaseTarget || !shooterVehicle) return null;
  const mine = chaseOf(shooterVehicle.uuid);
  const theirs = chaseOf(chaseTarget);
  if (!mine || theirs?.chase.id !== mine.chase.id) return null;
  return pseudoTarget(fromUuidSync(chaseTarget));
}

/**
 * The chase situation for an attack or ram from `shooterVehicle` at `targetVehicle`.
 * @returns {null|{chase, shooter, target, distance, sameChase}}  null when the shooter isn't in a chase
 */
export function chaseSituation(shooterVehicle, targetVehicle) {
  const mine = chaseOf(shooterVehicle?.uuid);
  if (!mine) return null;
  const theirs = targetVehicle ? chaseOf(targetVehicle.uuid) : null;
  const sameChase = theirs?.chase.id === mine.chase.id;
  return {
    chase: mine.chase,
    shooter: mine.entry,
    target: sameChase ? theirs.entry : null,
    distance: sameChase ? chaseDistance(mine.entry.pos, theirs.entry.pos) : null,
    sameChase
  };
}
