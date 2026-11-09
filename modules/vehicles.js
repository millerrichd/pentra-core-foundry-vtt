/**
 * Vehicles: crew assignment, driving checks, collisions, mounted weapons, buying and selling.
 *
 * Vehicles are world actors. Players can't create or delete world actors in Foundry, so buying and selling
 * a vehicle asks the active GM's client to do that part (see `gmRequest`).
 */
import { PENTRA } from "./config.js";
import { acquireGear } from "./documents.js";
import * as Rolls from "./rolls.js";
import { chaseOf, chaseSituation, chaseTargetFor } from "./apps/chase-state.js";
import { CHASE_BANDS } from "./rules.js";

const SYSTEM = "pentra-core-foundry-vtt";
const SOCKET = `system.${SYSTEM}`;
const { DialogV2 } = foundry.applications.api;
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/* -------------------------------------------------------------------------- */
/*  Lookups                                                                   */
/* -------------------------------------------------------------------------- */

/** Vehicles a character owns. */
export function vehiclesOwnedBy(actor) {
  return game.actors.filter(v => v.type === "vehicle" && v.system.owner === actor.uuid);
}

/** The actor's role aboard a vehicle: "driver", "passenger", or null. */
export function crewRole(vehicle, actor) {
  if (!actor) return null;
  if (Rolls.isActor(vehicle.system.crew.driver, actor)) return "driver";
  if (vehicle.system.crew.passengers.some(u => Rolls.isActor(u, actor))) return "passenger";
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Crew                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Put someone aboard. They leave any other vehicle they were in (where this user can edit it).
 * Making someone the driver moves the old driver to the passengers.
 * @param {Actor} vehicle
 * @param {Actor} actor
 * @param {"driver"|"passenger"} [role]  Defaults to driver if the seat is empty, otherwise passenger.
 */
export async function assignCrew(vehicle, actor, role) {
  if (!["character", "npc"].includes(actor?.type)) return ui.notifications.warn(loc("PENTRA.Vehicle.CrewOnlyPeople"));
  for (const other of game.actors) {
    if (other.type !== "vehicle" || other === vehicle || !crewRole(other, actor) || !other.isOwner) continue;
    await removeCrew(other, actor.uuid);
  }
  const { driver, passengers } = vehicle.system.crew;
  role ??= (!driver || driver === actor.uuid) ? "driver" : "passenger";
  let nextPassengers = passengers.filter(u => u !== actor.uuid);
  let nextDriver = driver === actor.uuid ? "" : driver;
  if (role === "driver") {
    if (nextDriver) nextPassengers.unshift(nextDriver);
    nextDriver = actor.uuid;
  } else {
    nextPassengers.push(actor.uuid);
  }
  return vehicle.update({ "system.crew": { driver: nextDriver, passengers: nextPassengers } });
}

/** Take someone out of the vehicle (or clear a stale entry for a deleted actor). */
export function removeCrew(vehicle, uuid) {
  const { driver, passengers } = vehicle.system.crew;
  return vehicle.update({
    "system.crew": { driver: driver === uuid ? "" : driver, passengers: passengers.filter(u => u !== uuid) }
  });
}

/* -------------------------------------------------------------------------- */
/*  Driving                                                                   */
/* -------------------------------------------------------------------------- */

/** The driver, if there is one and this user may roll for them. */
function usableDriver(vehicle) {
  const driver = vehicle.system.driver;
  if (!driver) {
    ui.notifications.warn(fmt("PENTRA.Vehicle.NoDriver", { name: vehicle.name }));
    return null;
  }
  if (!driver.isOwner) {
    ui.notifications.warn(fmt("PENTRA.Vehicle.NotYourDriver", { name: driver.name }));
    return null;
  }
  return driver;
}

const handlingModifier = vehicle => ({ label: loc("PENTRA.Vehicle.Handling"), value: vehicle.system.handling });
const skillLabel = vehicle => loc(PENTRA.skills[vehicle.system.skill].label);

/**
 * A handling check: the driver rolls the vehicle's skill (Driving, Boating, Piloting or Riding) plus its Handling.
 * `kind` is "maneuver" or "push" (push: +1 movement on a success, -1 on a failure).
 */
export function driveCheck(vehicle, kind = "maneuver", { skipDialog = false } = {}) {
  const driver = usableDriver(vehicle);
  if (!driver) return;
  const what = loc(kind === "push" ? "PENTRA.Vehicle.Push" : "PENTRA.Vehicle.Maneuver");
  return Rolls.rollCheck(driver, {
    type: "skill", key: vehicle.system.skill, skipDialog,
    label: `${vehicle.name}: ${what} (${skillLabel(vehicle)})`,
    extraModifiers: [handlingModifier(vehicle)],
    note: kind === "push" ? loc("PENTRA.Vehicle.PushNote") : null
  });
}

/**
 * Ram the targeted vehicle: the driver's skill check (plus Handling) against its Evasion. Wounds equal the number
 * of successes, as an (every) success type; both vehicles take them and everyone aboard takes half.
 */
export function collide(vehicle, { skipDialog = false, target = null } = {}) {
  // In a chase, a vehicle rams only on its own turn.
  const inChase = chaseOf(vehicle.uuid);
  if (inChase && inChase.chase.current !== vehicle.uuid) {
    return ui.notifications.warn(fmt("PENTRA.Chase.NotYourTurn", { name: vehicle.name }));
  }
  // The driver makes the check, whoever else is aboard.
  const driver = usableDriver(vehicle);
  if (!driver) return;
  const targets = Array.from(game.user.targets);
  target ??= chaseTargetFor(vehicle) ?? (targets.length === 1 ? targets[0] : null);
  if (!target || target.actor?.type !== "vehicle" || target.actor === vehicle) {
    return ui.notifications.warn(loc("PENTRA.Vehicle.TargetVehicle"));
  }
  // In a chase, ramming needs both vehicles in the same Impact / Drive-by row.
  const chase = chaseSituation(vehicle, target.actor);
  if (chase && !chase.sameChase) return ui.notifications.warn(fmt("PENTRA.Chase.NotInChase", { target: target.name }));
  if (chase && chase.distance > 0) {
    return ui.notifications.warn(fmt("PENTRA.Chase.TooFarToRam", { target: target.name, band: loc(`PENTRA.Chase.Band.${CHASE_BANDS[chase.distance]}`) }));
  }
  return Rolls.rollCheck(driver, {
    type: "skill", key: vehicle.system.skill, skipDialog,
    label: fmt("PENTRA.Vehicle.CollideLabel", { name: vehicle.name, target: target.name }),
    tn: target.actor.system.evasion.value,
    targetToken: target,
    extraModifiers: [handlingModifier(vehicle)],
    collision: { vehicleUuid: vehicle.uuid },
    note: loc("PENTRA.Vehicle.CollisionHint")
  });
}

/* -------------------------------------------------------------------------- */
/*  Mounted weapons                                                           */
/* -------------------------------------------------------------------------- */

/** Ask which crew member is firing (skipped when only one is available to this user). */
async function chooseCrew(vehicle, title) {
  const crew = vehicle.system.aboard.filter(a => a.isOwner);
  if (!crew.length) {
    ui.notifications.warn(fmt("PENTRA.Vehicle.NoCrewYouControl", { name: vehicle.name }));
    return null;
  }
  if (crew.length === 1) return crew[0];
  const options = crew.map((a, i) => `<option value="${a.uuid}" ${i === 0 ? "selected" : ""}>${esc(a.name)}${crewRole(vehicle, a) === "driver" ? ` (${loc("PENTRA.Vehicle.Driver")})` : ""}</option>`).join("");
  const uuid = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${loc("PENTRA.Vehicle.WhoFires")}</label><select name="who">${options}</select></div>`,
    ok: { label: "PENTRA.Roll.Roll", icon: "fa-solid fa-crosshairs", callback: (event, button) => button.form.elements.who.value },
    rejectClose: false
  });
  return uuid ? fromUuidSync(uuid) : null;
}

/** Fire a mounted weapon: a crew member makes the attack, at -1 for firing from a vehicle. */
export async function fireWeapon(vehicle, weapon, { skipDialog = false } = {}) {
  const gunner = await chooseCrew(vehicle, fmt("PENTRA.Vehicle.FireTitle", { weapon: weapon.name }));
  if (!gunner) return;
  return Rolls.rollCheck(gunner, {
    type: "attack", weapon, skipDialog, fromVehicle: vehicle,
    label: `${weapon.name} (${vehicle.name})`,
    extraModifiers: [{ label: fmt("PENTRA.Vehicle.FiringFrom", { name: vehicle.name }), value: PENTRA.vehicleFirePenalty }]
  });
}

/* -------------------------------------------------------------------------- */
/*  Repair                                                                    */
/* -------------------------------------------------------------------------- */

/** Repair with a Crafting check: the owner or a crew member this user controls does the work. */
export async function repair(vehicle) {
  const candidates = [fromUuidSync(vehicle.system.owner), ...vehicle.system.aboard]
    .filter((a, i, all) => a?.isOwner && a.type !== "vehicle" && all.indexOf(a) === i);
  if (!candidates.length) return ui.notifications.warn(fmt("PENTRA.Vehicle.NoMechanic", { name: vehicle.name }));
  let mechanic = candidates[0];
  if (candidates.length > 1) {
    const options = candidates.map(a => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("");
    const uuid = await DialogV2.prompt({
      window: { title: fmt("PENTRA.Vehicle.RepairTitle", { name: vehicle.name }) },
      content: `<div class="form-group"><label>${loc("PENTRA.Vehicle.WhoRepairs")}</label><select name="who">${options}</select></div>`,
      ok: { label: "PENTRA.Roll.Roll", icon: "fa-solid fa-wrench", callback: (event, button) => button.form.elements.who.value },
      rejectClose: false
    });
    if (!uuid) return;
    mechanic = fromUuidSync(uuid);
  }
  return Rolls.repairVehicle(mechanic, vehicle);
}

/* -------------------------------------------------------------------------- */
/*  Buying and selling                                                        */
/* -------------------------------------------------------------------------- */

/** Ownership for a vehicle: the same players who own the character. */
function ownershipFrom(character) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const [id, level] of Object.entries(character.ownership)) {
    if (id !== "default" && level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) ownership[id] = level;
  }
  return ownership;
}

/**
 * A vehicle actor was dropped on a character: buy it with the Resource Die (or the GM gifts it).
 * From a compendium a new world vehicle is created; a world vehicle with no owner is handed over.
 */
export async function acquireVehicle(character, vehicle) {
  if (vehicle.system.owner && !vehicle.pack) {
    if (vehicle.system.owner === character.uuid) return vehicle.sheet.render(true);
    const current = fromUuidSync(vehicle.system.owner);
    return ui.notifications.warn(fmt("PENTRA.Vehicle.AlreadyOwned", { name: vehicle.name, owner: current?.name ?? "?" }));
  }
  if (!game.users.activeGM) return ui.notifications.warn(loc("PENTRA.Vehicle.NeedGM"));
  if ((await acquireGear(character, { name: vehicle.name, cost: vehicle.system.cost }, game.user)) === false) return;

  if (vehicle.pack) {
    const data = game.actors.fromCompendium(vehicle);
    return gmRequest("createVehicle", { data, characterUuid: character.uuid });
  }
  return gmRequest("giveVehicle", { vehicleUuid: vehicle.uuid, characterUuid: character.uuid });
}

/** Sell a vehicle: the owner's Resource Die sale roll, then the vehicle is removed from the world. */
export async function sellVehicle(vehicle) {
  const owner = fromUuidSync(vehicle.system.owner);
  if (!owner?.isOwner) return ui.notifications.warn(fmt("PENTRA.Vehicle.NotYourVehicle", { name: vehicle.name }));
  if (!game.users.activeGM) return ui.notifications.warn(loc("PENTRA.Vehicle.NeedGM"));
  const ok = await DialogV2.confirm({
    window: { title: loc("PENTRA.Sell.Title") },
    content: `<p>${fmt("PENTRA.Sell.Confirm", { name: esc(vehicle.name) })}</p><p class="hint">${loc("PENTRA.Vehicle.SellRemoves")}</p>`
  });
  if (!ok) return;
  await Rolls.sell(owner, { label: vehicle.name, costDie: vehicle.system.cost.die, multiplier: vehicle.system.cost.multiplier });
  return gmRequest("deleteVehicle", { vehicleUuid: vehicle.uuid, characterUuid: owner.uuid });
}

/* -------------------------------------------------------------------------- */
/*  GM relay                                                                  */
/* -------------------------------------------------------------------------- */

/** Run a world-level change as the GM: directly if we are the active GM, otherwise over the socket. */
function gmRequest(action, payload) {
  const request = { action, userId: game.user.id, ...payload };
  if (game.users.activeGM?.isSelf) return handleRequest(request);
  game.socket.emit(SOCKET, request);
}

/** Only the active GM acts on requests, and only for characters the requesting user owns. */
async function handleRequest({ scope, action, userId, characterUuid, vehicleUuid, data }) {
  // Other features (chases) share the socket and tag their requests with a scope.
  if (scope || !game.users.activeGM?.isSelf) return;
  const user = game.users.get(userId);
  const character = fromUuidSync(characterUuid);
  if (!user || character?.type !== "character" || !character.testUserPermission(user, "OWNER")) return;

  switch (action) {
    case "createVehicle": {
      if (data?.type !== "vehicle") return;
      data.ownership = ownershipFrom(character);
      data.system = { ...data.system, owner: character.uuid, crew: { driver: character.uuid, passengers: [] } };
      const [vehicle] = await Actor.implementation.create([data]);
      return announce(character, fmt("PENTRA.Vehicle.Acquired", { name: esc(vehicle.name), actor: esc(character.name) }));
    }
    case "giveVehicle": {
      const vehicle = fromUuidSync(vehicleUuid);
      if (vehicle?.type !== "vehicle" || vehicle.system.owner) return;
      await vehicle.update({ ownership: ownershipFrom(character), "system.owner": character.uuid });
      return announce(character, fmt("PENTRA.Vehicle.Acquired", { name: esc(vehicle.name), actor: esc(character.name) }));
    }
    case "deleteVehicle": {
      const vehicle = fromUuidSync(vehicleUuid);
      if (vehicle?.type !== "vehicle" || vehicle.system.owner !== character.uuid) return;
      const name = vehicle.name;
      await vehicle.delete();
      return announce(character, fmt("PENTRA.Vehicle.Sold", { name: esc(name), actor: esc(character.name) }));
    }
  }
}

function announce(actor, text) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><i class="fa-solid fa-car-side"></i> ${text}</p>` });
}

export function registerVehicleSocket() {
  game.socket.on(SOCKET, handleRequest);
}

/* -------------------------------------------------------------------------- */
/*  Migration                                                                 */
/* -------------------------------------------------------------------------- */

/** Map an old vehicle item's data onto the vehicle actor schema. */
function actorDataFromItem(item) {
  const s = item.system;
  return {
    name: item.name, type: "vehicle", img: item.img,
    system: {
      description: s.description, cost: s.cost, legal: s.legal, category: s.category, speedClass: s.speedClass,
      health: s.health, evasion: { base: s.evasion }, ar: s.armor, heavyArmor: s.heavyArmor,
      durability: s.durability, handling: s.handling, mounts: s.mounts, mountNotes: s.mountNotes
    }
  };
}

/**
 * One-time conversion of old vehicle items into vehicle actors. A character's vehicle becomes a world vehicle it
 * owns and drives; a vehicle item in the Items sidebar becomes an unowned vehicle actor.
 */
export async function migrateVehicleItems() {
  if (!game.users.activeGM?.isSelf) return;
  let count = 0;
  for (const actor of game.actors) {
    if (actor.type !== "character" && actor.type !== "npc") continue;
    const items = actor.items.filter(i => i.type === "vehicle");
    if (!items.length) continue;
    const data = items.map(i => foundry.utils.mergeObject(actorDataFromItem(i), {
      ownership: ownershipFrom(actor),
      system: { owner: actor.type === "character" ? actor.uuid : "", crew: { driver: actor.uuid, passengers: [] } }
    }));
    await Actor.implementation.create(data);
    await actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
    count += items.length;
  }
  const loose = game.items.filter(i => i.type === "vehicle");
  if (loose.length) {
    await Actor.implementation.create(loose.map(actorDataFromItem));
    await Item.implementation.deleteDocuments(loose.map(i => i.id));
    count += loose.length;
  }
  if (count) ui.notifications.info(fmt("PENTRA.Vehicle.Migrated", { count }));
}
