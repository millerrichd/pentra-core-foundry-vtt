import { PENTRA } from "../config.js";
import { formatDie } from "../rules.js";
import { PentraFieldKitModel } from "../models.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;
const SYSTEM = "pentra-core-foundry-vtt";
const TEMPLATES = `systems/${SYSTEM}/templates/item`;
const loc = key => game.i18n.localize(key);

const labelMap = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "string" ? v : v.label]));

export class PentraItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pentra", "sheet", "item"],
    position: { width: 520, height: 560 },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/item-header.hbs` },
    details: { template: `${TEMPLATES}/details-gear.hbs` },
    description: { template: `${TEMPLATES}/item-description.hbs`, scrollable: [""] }
  };

  /** Use a details template specific to the item type. @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.details.template = `${TEMPLATES}/details-${this.item.type}.hbs`;
    parts.details.templates = [`${TEMPLATES}/physical.hbs`];
    return parts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const usageDice = Object.fromEntries(PENTRA.usageDice.map(d => [d, d ? formatDie(d) : loc("PENTRA.Broken")]));
    Object.assign(context, {
      item,
      system: item.system,
      source: item.system._source,
      editable: this.isEditable,
      config: PENTRA,
      typeLabel: loc(CONFIG.Item.typeLabels[item.type]),
      options: {
        dice: Object.fromEntries(PENTRA.usageDice.filter(d => d).map(d => [d, formatDie(d)])),
        usageDice,
        multipliers: Object.fromEntries([1, 2, 3, 4, 5, 6].map(m => [m, `x${m}`])),
        sizes: labelMap(PENTRA.sizes),
        attributes: { "": "PENTRA.None", ...PENTRA.attributes },
        traits: { "": "PENTRA.None", ...labelMap(PENTRA.traits) },
        increments: PENTRA.increments,
        ranges: PENTRA.rangeBands,
        weaponCategories: PENTRA.weaponCategories,
        vehicleCategories: PENTRA.vehicleCategories,
        attackSkills: Object.fromEntries(PENTRA.attackSkills.map(k => [k, PENTRA.skills[k].label])),
        kitTypes: Object.fromEntries(PentraFieldKitModel.KIT_TYPES.map(k => [k, `PENTRA.KitType.${k}`])),
        hands: { 0: "PENTRA.Hands.mounted", 1: "PENTRA.Hands.one", 2: "PENTRA.Hands.two" }
      },
      locations: Object.entries(PENTRA.hitLocations).map(([key, l]) => ({ key, label: loc(l.label), checked: item.system.coverage?.[key] })),
      enrichedDescription: await TextEditor.implementation.enrichHTML(item.system.description, { relativeTo: item, secrets: item.isOwner })
    });
    return context;
  }
}
