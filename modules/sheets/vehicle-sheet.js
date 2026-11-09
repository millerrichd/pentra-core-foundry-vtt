import { PENTRA } from "../config.js";
import { formatDie } from "../rules.js";
import * as Vehicles from "../vehicles.js";
import * as Chases from "../apps/chases.js";
import { chaseOf } from "../apps/chase-state.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;
const SYSTEM = "pentra-core-foundry-vtt";
const TEMPLATES = `systems/${SYSTEM}/templates/actor`;
const loc = key => game.i18n.localize(key);

const dieOptions = dice => Object.fromEntries(dice.map(d => [d, d ? formatDie(d) : loc("PENTRA.Broken")]));

/**
 * Vehicle sheet: stats, crew (driver and passengers), driving checks, mounted weapons, repair and sale.
 * Drag a character or NPC onto the sheet to put them aboard; drop on the driver seat to make them the driver.
 */
export class PentraVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pentra", "sheet", "actor", "vehicle"],
    position: { width: 640, height: 720 },
    form: { submitOnChange: true },
    window: { resizable: true },
    actions: {
      stepHealth: PentraVehicleSheet.#onStepHealth,
      maneuver: PentraVehicleSheet.#onManeuver,
      push: PentraVehicleSheet.#onPush,
      collide: PentraVehicleSheet.#onCollide,
      repair: PentraVehicleSheet.#onRepair,
      sell: PentraVehicleSheet.#onSell,
      crewOpen: PentraVehicleSheet.#onCrewOpen,
      crewRemove: PentraVehicleSheet.#onCrewRemove,
      crewDrive: PentraVehicleSheet.#onCrewDrive,
      openOwner: PentraVehicleSheet.#onOpenOwner,
      fire: PentraVehicleSheet.#onFire,
      itemEdit: PentraVehicleSheet.#onItemEdit,
      itemDelete: PentraVehicleSheet.#onItemDelete
    }
  };

  static PARTS = {
    body: { template: `${TEMPLATES}/vehicle-sheet.hbs`, scrollable: [".vehicle-body"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const driver = sys.driver;
    const crewEntry = (a, role) => ({
      uuid: a.uuid, name: a.name, img: a.img, role, isOwner: a.isOwner,
      skill: a.system.skills?.[sys.skill] ?? 0
    });
    const missing = [sys.crew.driver, ...sys.crew.passengers].filter(u => u && !fromUuidSync(u));
    const owner = sys.owner ? fromUuidSync(sys.owner) : null;

    Object.assign(context, {
      actor,
      system: sys,
      source: actor._source.system,
      editable: this.isEditable,
      isGM: game.user.isGM,
      categories: PENTRA.vehicleCategories,
      categoryLabel: loc(PENTRA.vehicleCategories[sys.category]),
      sizes: PENTRA.creatureSizes,
      sizeLabel: loc(PENTRA.creatureSizes[sys.size] ?? ""),
      mods: actor.items.filter(i => i.type === "vehiclemod").map(m => ({
        id: m.id, name: m.name, img: m.img, effect: loc(`PENTRA.VehicleMod.Effects.${m.system.mod}`)
      })),
      skillLabel: loc(PENTRA.skills[sys.skill].label),
      handling: sys.handling > 0 ? `+${sys.handling}` : `${sys.handling}`,
      damaged: sys.health.value < sys.health.max,
      dice: dieOptions(PENTRA.usageDice),
      maxDice: dieOptions(PENTRA.usageDice.filter(d => d > 0)),
      costDice: dieOptions(PENTRA.usageDice.filter(d => d > 0)),
      driver: driver ? crewEntry(driver, "driver") : null,
      passengers: sys.passengers.map(p => crewEntry(p, "passenger")),
      missingCrew: missing,
      owner: owner ? { name: owner.name, uuid: owner.uuid } : null,
      canSell: !!owner?.isOwner,
      weapons: actor.items.filter(i => i.type === "weapon").map(w => ({
        id: w.id, name: w.name, img: w.img, damage: w.system.damageLabel,
        skill: loc(PENTRA.skills[w.system.skill]?.label ?? ""), range: loc(PENTRA.rangeBands[w.system.range] ?? "")
      })),
      enrichedDescription: await TextEditor.implementation.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    context.mountsUsed = context.weapons.length;
    context.mountsOver = context.mountsUsed > sys.mounts;
    return context;
  }

  /** Put a dropped character or NPC aboard; vehicle weapons dropped here are mounted. @override */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (actor.type === "vehicle") return null;
    if (actor.pack) return ui.notifications.warn(loc("PENTRA.Vehicle.CrewFromWorld"));
    const seat = event.target.closest("[data-crew-seat]")?.dataset.crewSeat;
    return Vehicles.assignCrew(this.actor, actor, seat);
  }

  /** @override */
  async _onDropItem(event, item) {
    if (!this.isEditable) return null;
    if (!["weapon", "vehiclemod"].includes(item.type)) {
      ui.notifications.warn(loc("PENTRA.Vehicle.OnlyWeapons"));
      return null;
    }
    return super._onDropItem(event, item);
  }

  _crewUuid(target) {
    return target.closest("[data-uuid]")?.dataset.uuid;
  }

  _getItem(target) {
    return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  /* ------------------------------------------------------------------------ */

  /** Mark a wound (-), or as GM undo one (+). Restoring Health otherwise takes a repair. */
  static #onStepHealth(event, target) {
    const { value, max } = this.actor.system.health;
    const next = Math.clamp(value + Number(target.dataset.delta), 0, max);
    if (next !== value) return this.actor.update({ "system.health.value": next });
  }

  static #onManeuver(event) {
    return Vehicles.driveCheck(this.actor, "maneuver", { skipDialog: event.shiftKey });
  }

  /** In a chase, a push spends movement and moves the vehicle; otherwise it's just the handling check. */
  static #onPush(event) {
    const inChase = chaseOf(this.actor.uuid);
    if (inChase) return Chases.push(inChase.chase.id, this.actor.uuid, { skipDialog: event.shiftKey });
    return Vehicles.driveCheck(this.actor, "push", { skipDialog: event.shiftKey });
  }

  static #onCollide(event) {
    return Vehicles.collide(this.actor, { skipDialog: event.shiftKey });
  }

  static #onRepair() {
    return Vehicles.repair(this.actor);
  }

  static #onSell() {
    return Vehicles.sellVehicle(this.actor);
  }

  static #onCrewOpen(event, target) {
    fromUuidSync(this._crewUuid(target))?.sheet.render(true);
  }

  static #onCrewRemove(event, target) {
    return Vehicles.removeCrew(this.actor, this._crewUuid(target));
  }

  static #onCrewDrive(event, target) {
    const actor = fromUuidSync(this._crewUuid(target));
    if (actor) return Vehicles.assignCrew(this.actor, actor, "driver");
  }

  static #onOpenOwner() {
    fromUuidSync(this.actor.system.owner)?.sheet.render(true);
  }

  static #onFire(event, target) {
    const weapon = this._getItem(target);
    if (weapon) return Vehicles.fireWeapon(this.actor, weapon, { skipDialog: event.shiftKey });
  }

  static #onItemEdit(event, target) {
    this._getItem(target)?.sheet.render(true);
  }

  static #onItemDelete(event, target) {
    return this._getItem(target)?.deleteDialog();
  }
}
