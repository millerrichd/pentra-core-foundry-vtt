/**
 * Pentra: Five-Dice Engine — Foundry VTT system entry point.
 */
import { PENTRA } from "./config.js";
import * as models from "./models.js";
import * as rules from "./rules.js";
import * as Rolls from "./rolls.js";
import {
  PentraActor, PentraItem, PentraCombat, PentraCombatant, PentraTokenDocument, onUpdateCombat, onDeleteCombat, onRenderCombatTracker
} from "./documents.js";
import { PentraCharacterSheet, PentraNPCSheet } from "./sheets/actor-sheet.js";
import { PentraItemSheet } from "./sheets/item-sheet.js";
import { PentraVehicleSheet } from "./sheets/vehicle-sheet.js";
import * as Vehicles from "./vehicles.js";
import { registerRulers } from "./rulers.js";
import { registerGMTools } from "./gm-tools.js";
import { PentraPartyApp } from "./apps/party.js";
import { PentraCountersApp, registerCounterSetting } from "./apps/counters.js";
import { registerChaseSocket } from "./apps/chases.js";
import { PentraChaseApp, registerChaseSetting } from "./apps/chase-app.js";
import { PentraClocksApp, registerClockSetting } from "./apps/clocks.js";
import * as Underwater from "./underwater.js";
import { onRenderCombatTrackerUnderwater } from "./underwater.js";

const SYSTEM = "pentra-core-foundry-vtt";

Hooks.once("init", () => {
  console.log("Pentra | Initializing the Five-Dice Engine");

  CONFIG.PENTRA = PENTRA;
  game.pentra = { config: PENTRA, rules, rolls: Rolls, vehicles: Vehicles, party: () => PentraPartyApp.open(), counters: () => PentraCountersApp.open(), chase: () => PentraChaseApp.open(), clocks: () => PentraClocksApp.open(), underwater: Underwater };

  // Documents
  CONFIG.Actor.documentClass = PentraActor;
  CONFIG.Item.documentClass = PentraItem;
  CONFIG.Combat.documentClass = PentraCombat;
  CONFIG.Combatant.documentClass = PentraCombatant;
  CONFIG.Token.documentClass = PentraTokenDocument;
  CONFIG.Combat.initiative = { formula: "1d6", decimals: 0 };

  // Data models
  Object.assign(CONFIG.Actor.dataModels, {
    character: models.PentraCharacterModel,
    npc: models.PentraNPCModel,
    vehicle: models.PentraVehicleActorModel
  });
  Object.assign(CONFIG.Item.dataModels, {
    ancestry: models.PentraAncestryModel,
    hindrance: models.PentraHindranceModel,
    talent: models.PentraTalentModel,
    armor: models.PentraArmorModel,
    weapon: models.PentraWeaponModel,
    fieldkit: models.PentraFieldKitModel,
    vehicle: models.PentraVehicleModel,
    vehiclemod: models.PentraVehicleModModel,
    disease: models.PentraDiseaseModel
  });

  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["health"], value: ["edge.value", "karma.value"] },
    npc: { bar: ["health"], value: [] },
    vehicle: { bar: ["health"], value: [] }
  };

  // Status effects from the rulebook replace the core set.
  CONFIG.statusEffects = PENTRA.statusEffects.map(e => ({ ...e }));
  CONFIG.specialStatusEffects.DEFEATED = "dead";

  // Sheets
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, SYSTEM, PentraCharacterSheet, {
    types: ["character"], makeDefault: true, label: "PENTRA.Sheet.Character"
  });
  DocumentSheetConfig.registerSheet(Actor, SYSTEM, PentraNPCSheet, {
    types: ["npc"], makeDefault: true, label: "PENTRA.Sheet.NPC"
  });
  DocumentSheetConfig.registerSheet(Actor, SYSTEM, PentraVehicleSheet, {
    types: ["vehicle"], makeDefault: true, label: "PENTRA.Sheet.Vehicle"
  });
  DocumentSheetConfig.registerSheet(Item, SYSTEM, PentraItemSheet, {
    makeDefault: true, label: "PENTRA.Sheet.Item"
  });

  registerSettings();
  registerHandlebarsHelpers();
  registerRulers();
});

Hooks.once("i18nInit", () => {
  // Pre-localize status effect names so token HUD tooltips read nicely.
  for (const effect of CONFIG.statusEffects) effect.name = game.i18n.localize(effect.name);
});

Hooks.once("ready", async () => {
  Vehicles.registerVehicleSocket();
  registerChaseSocket();
  // One-time: vehicles used to be items; turn them into vehicle actors.
  if (game.user.isActiveGM && !game.settings.get(SYSTEM, "vehiclesMigrated")) {
    await Vehicles.migrateVehicleItems();
    await game.settings.set(SYSTEM, "vehiclesMigrated", true);
  }
});

/** Everyone a vehicle is linked to: its owner and crew. */
const vehiclePeople = actor => [actor.system.owner, actor.system.crew.driver, ...actor.system.crew.passengers].filter(Boolean);

/** Character sheets list their vehicles, so redraw them (including anyone who just left) when a vehicle changes. */
function refreshVehicleOwners(actor, changed, options) {
  if (actor.type !== "vehicle") return;
  const uuids = new Set([...vehiclePeople(actor), ...(options?.pentraPreviousPeople ?? [])]);
  for (const uuid of uuids) {
    const sheet = fromUuidSync(uuid)?.sheet;
    if (sheet?.rendered) sheet.render();
  }
}
Hooks.on("createActor", (actor, options) => refreshVehicleOwners(actor, null, options));
Hooks.on("deleteActor", (actor, options) => refreshVehicleOwners(actor, null, options));
Hooks.on("preUpdateActor", (actor, changed, options) => {
  if (actor.type === "vehicle") options.pentraPreviousPeople = vehiclePeople(actor);
});
Hooks.on("updateActor", refreshVehicleOwners);

Hooks.on("updateCombat", onUpdateCombat);
Hooks.on("deleteCombat", onDeleteCombat);
Hooks.on("renderCombatTracker", onRenderCombatTracker);
Hooks.on("renderCombatTracker", onRenderCombatTrackerUnderwater);
Hooks.on("renderChatMessageHTML", onRenderChatMessage);
registerGMTools();

/* -------------------------------------------------------------------------- */

function registerSettings() {
  game.settings.register(SYSTEM, "targetNumber", {
    name: "PENTRA.Settings.TargetNumber.Name",
    hint: "PENTRA.Settings.TargetNumber.Hint",
    scope: "world", config: true, type: Number, default: PENTRA.defaultTN
  });
  game.settings.register(SYSTEM, "rerollInitiative", {
    name: "PENTRA.Settings.Reroll.Name",
    hint: "PENTRA.Settings.Reroll.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM, "rangeBandRuler", {
    name: "PENTRA.Settings.RangeRuler.Name",
    hint: "PENTRA.Settings.RangeRuler.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  registerCounterSetting();
  registerChaseSetting();
  registerClockSetting();
  game.settings.register(SYSTEM, "vehiclesMigrated", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register(SYSTEM, "showDrainDie", {
    name: "PENTRA.Settings.Drain.Name",
    hint: "PENTRA.Settings.Drain.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("pentraDie", faces => rules.formatDie(Number(faces) || 0));
  Handlebars.registerHelper("pentraSigned", n => (n > 0 ? `+${n}` : `${n}`));
  Handlebars.registerHelper("pentraRange", (min, max) => {
    const out = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  });
}

/* -------------------------------------------------------------------------- */
/*  Chat card interactivity                                                   */
/* -------------------------------------------------------------------------- */

/** Actors to apply damage to: controlled tokens first, otherwise the user's targets. */
function damageRecipients(message) {
  let tokens = canvas?.tokens?.controlled ?? [];
  if (!tokens.length) tokens = Array.from(game.user.targets);
  const actors = tokens.map(t => t.actor).filter(Boolean);
  if (actors.length) return actors;
  // Fall back to the target recorded on the attack (a token, or a chase vehicle's actor).
  const uuid = message.getFlag(SYSTEM, "targetUuid");
  const doc = uuid ? fromUuidSync(uuid) : null;
  const actor = doc?.actor ?? (doc instanceof Actor ? doc : null);
  return actor ? [actor] : [];
}

function onRenderChatMessage(message, html) {
  for (const button of html.querySelectorAll("[data-pentra-action]")) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const damage = message.getFlag(SYSTEM, "damage");
      switch (button.dataset.pentraAction) {
        case "apply-damage": {
          const actors = damageRecipients(message);
          if (!actors.length) return ui.notifications.warn(game.i18n.localize("PENTRA.Damage.NoTarget"));
          const half = button.dataset.half === "true";
          const wounds = half ? Math.floor(damage.wounds / 2) : damage.wounds;
          for (const actor of actors) {
            if (!actor.isOwner) {
              ui.notifications.warn(game.i18n.format("PENTRA.Damage.NotOwner", { name: actor.name }));
              continue;
            }
            await Rolls.applyWounds(actor, wounds, damage.location);
            // A burning weapon's hit sets the target on fire (1 wound at the end of each turn until put out).
            if (damage.burning && !actor.statuses.has("dead") && !actor.statuses.has("burning")) {
              await actor.toggleStatusEffect("burning", { active: true });
            }
          }
          break;
        }
        case "take-scar": {
          const actor = fromUuidSync(message.getFlag(SYSTEM, "scarUuid"));
          await Rolls.chooseScar(actor);
          break;
        }
        case "apply-collision": {
          const token = fromUuidSync(message.getFlag(SYSTEM, "targetUuid"));
          const target = token?.actor ?? token;
          await Rolls.applyCollision(damage, target);
          break;
        }
        case "apply-stabilize": {
          const doc = fromUuidSync(message.getFlag(SYSTEM, "stabilizeUuid"));
          const actor = doc?.actor ?? doc;
          if (!actor) return ui.notifications.warn(game.i18n.localize("PENTRA.Damage.NoTarget"));
          if (!actor.isOwner) return ui.notifications.warn(game.i18n.format("PENTRA.Damage.NotOwner", { name: actor.name }));
          button.disabled = true;
          await Rolls.resolveDying(actor, game.i18n.format("PENTRA.Dying.ByStabilize", { name: message.getFlag(SYSTEM, "stabilizedBy") }));
          break;
        }
        case "apply-healing": {
          const amount = message.getFlag(SYSTEM, "heal");
          const doc = fromUuidSync(message.getFlag(SYSTEM, "healUuid"));
          const actor = doc?.actor ?? doc;
          if (!actor) return ui.notifications.warn(game.i18n.localize("PENTRA.Damage.NoTarget"));
          if (!actor.isOwner) return ui.notifications.warn(game.i18n.format("PENTRA.Damage.NotOwner", { name: actor.name }));
          const health = await Rolls.healWounds(actor, amount);
          ui.notifications.info(game.i18n.format("PENTRA.Medicine.Healed", { name: actor.name, amount, health, max: actor.system.health.max }));
          button.disabled = true;
          break;
        }
      }
    });
  }
}
