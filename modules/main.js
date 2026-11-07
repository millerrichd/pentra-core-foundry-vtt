/**
 * Pentra: Five-Dice Engine — Foundry VTT system entry point.
 */
import { PENTRA } from "./config.js";
import * as models from "./models.js";
import * as rules from "./rules.js";
import * as Rolls from "./rolls.js";
import {
  PentraActor, PentraItem, PentraCombat, PentraCombatant, onUpdateCombat, onRenderCombatTracker
} from "./documents.js";
import { PentraCharacterSheet, PentraNPCSheet } from "./sheets/actor-sheet.js";
import { PentraItemSheet } from "./sheets/item-sheet.js";

const SYSTEM = "pentra-core-foundry-vtt";

Hooks.once("init", () => {
  console.log("Pentra | Initializing the Five-Dice Engine");

  CONFIG.PENTRA = PENTRA;
  game.pentra = { config: PENTRA, rules, rolls: Rolls };

  // Documents
  CONFIG.Actor.documentClass = PentraActor;
  CONFIG.Item.documentClass = PentraItem;
  CONFIG.Combat.documentClass = PentraCombat;
  CONFIG.Combatant.documentClass = PentraCombatant;
  CONFIG.Combat.initiative = { formula: "1d6", decimals: 0 };

  // Data models
  Object.assign(CONFIG.Actor.dataModels, {
    character: models.PentraCharacterModel,
    npc: models.PentraNPCModel
  });
  Object.assign(CONFIG.Item.dataModels, {
    ancestry: models.PentraAncestryModel,
    hindrance: models.PentraHindranceModel,
    talent: models.PentraTalentModel,
    armor: models.PentraArmorModel,
    weapon: models.PentraWeaponModel,
    fieldkit: models.PentraFieldKitModel,
    gear: models.PentraGearModel,
    vehicle: models.PentraVehicleModel
  });

  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["health"], value: ["edge.value", "karma.value"] },
    npc: { bar: ["health"], value: [] }
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
  DocumentSheetConfig.registerSheet(Item, SYSTEM, PentraItemSheet, {
    makeDefault: true, label: "PENTRA.Sheet.Item"
  });

  registerSettings();
  registerHandlebarsHelpers();
});

Hooks.once("i18nInit", () => {
  // Pre-localize status effect names so token HUD tooltips read nicely.
  for (const effect of CONFIG.statusEffects) effect.name = game.i18n.localize(effect.name);
});

Hooks.on("updateCombat", onUpdateCombat);
Hooks.on("renderCombatTracker", onRenderCombatTracker);
Hooks.on("renderChatMessageHTML", onRenderChatMessage);

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
  // Fall back to the target recorded on the attack.
  const uuid = message.getFlag(SYSTEM, "targetUuid");
  const token = uuid ? fromUuidSync(uuid) : null;
  return token?.actor ? [token.actor] : [];
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
          }
          break;
        }
      }
    });
  }
}
