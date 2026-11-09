/**
 * The Chase window: every running vehicle chase (see chases.js for the rules). Everyone can open it; players see the
 * vehicles the GM has made visible plus their own, and move the vehicles they own.
 */
import * as Chases from "./chases.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const SYSTEM = "pentra-core-foundry-vtt";

const chaseId = el => el.closest("[data-chase-id]")?.dataset.chaseId;
const vehicleUuid = el => el.closest("[data-vehicle]")?.dataset.vehicle;

export function registerChaseSetting() {
  Chases.registerChaseSetting(() => PentraChaseApp.refresh());
  // Vehicle health (and crew) live on the actors: keep the window current as they take damage.
  Hooks.on("updateActor", actor => {
    if (actor.type === "vehicle") PentraChaseApp.refresh();
  });
}

export class PentraChaseApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pentra-chase",
    classes: ["pentra", "chase-app"],
    window: { title: "PENTRA.Chase.Title", icon: "fa-solid fa-car-burst", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      chaseAdd: () => Chases.addChase(),
      chaseRemove: (event, target) => Chases.removeChase(chaseId(target)),
      chaseRound: (event, target) => Chases.newRound(chaseId(target)),
      chaseMove: (event, target) => Chases.move(chaseId(target), vehicleUuid(target)),
      chaseTurn: (event, target) => Chases.turn(chaseId(target), vehicleUuid(target)),
      chasePush: (event, target) => Chases.push(chaseId(target), vehicleUuid(target), { skipDialog: event.shiftKey }),
      chaseRam: (event, target) => Chases.ram(chaseId(target), vehicleUuid(target), { skipDialog: event.shiftKey }),
      chaseEndTurn: (event, target) => Chases.endTurn(chaseId(target), vehicleUuid(target)),
      chaseTarget: PentraChaseApp.#onTarget,
      chaseAnchor: (event, target) => Chases.chooseAnchor(chaseId(target), vehicleUuid(target)),
      chaseVisible: (event, target) => Chases.toggleVisible(chaseId(target), vehicleUuid(target)),
      chaseFlip: (event, target) => Chases.gmFlip(chaseId(target), vehicleUuid(target)),
      chaseSplit: (event, target) => Chases.transferVehicle(vehicleUuid(target)),
      chaseRejoin: (event, target) => Chases.rejoin(chaseId(target), vehicleUuid(target)),
      chaseDrop: (event, target) => Chases.removeVehicle(chaseId(target), vehicleUuid(target)),
      chaseOpen: (event, target) => fromUuidSync(vehicleUuid(target))?.sheet.render(true)
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM}/templates/apps/chase.hbs` }
  };

  static #instance = null;

  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** Re-render if open (the setting changed, on any client). */
  static refresh() {
    if (this.#instance?.rendered) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const isGM = game.user.isGM;
    return { isGM, ...Chases.chasesContext(isGM) };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    if (game.user.isGM) this.#activateDragDrop();
  }

  /** Pick (or clear) this user's chase target, used by attacks and rams from a vehicle in the same chase. */
  static #onTarget(event, target) {
    Chases.target(vehicleUuid(target));
    this.render();
  }

  /**
   * Drag and drop (GM): drop a vehicle actor from the sidebar onto a lane row to add it there; drag a vehicle's chip
   * to another row to move it, or onto another chase's lane to move it into that chase.
   */
  #activateDragDrop() {
    for (const input of this.element.querySelectorAll("[data-chase-field]")) {
      input.addEventListener("change", () => Chases.renameChase(chaseId(input), input.value));
    }
    for (const chip of this.element.querySelectorAll(".chase-chip[draggable]")) {
      chip.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: Chases.CHASE_DRAG, chaseId: chaseId(chip), uuid: vehicleUuid(chip) }));
      });
    }
    for (const zone of this.element.querySelectorAll("[data-chase-id] .chase-row, [data-chase-id] .chase-lane")) {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", async event => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove("drag-over");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const to = chaseId(zone);
        const pos = Number(zone.closest("[data-pos]")?.dataset.pos ?? 0);
        if (data?.type === Chases.CHASE_DRAG) {
          return data.chaseId === to ? Chases.placeVehicle(to, data.uuid, pos) : Chases.transferVehicle(data.uuid, to, pos);
        }
        if (data?.type === "Actor") {
          const actor = await fromUuid(data.uuid);
          if (actor?.type !== "vehicle") return ui.notifications.warn(game.i18n.localize("PENTRA.Chase.VehiclesOnly"));
          return Chases.addVehicle(to, actor, pos);
        }
      });
    }
  }
}
