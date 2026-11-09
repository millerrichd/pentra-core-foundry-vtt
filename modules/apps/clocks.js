/**
 * Time clocks (GM only): Facility Raid, Travel and Camp. Each advances in its own time step and rolls a usage die;
 * a 1–2 means something happens. Results are whispered to the GM so the players don't see what's coming.
 *
 *  - Facility Raid: 10-minute segments; every 30 minutes the GM's danger die (d4 very dangerous … d12 fairly safe).
 *  - Travel: 1-hour segments; the die depends on the mode of travel, and an encounter rolls d4 for its type.
 *  - Camp: 4-hour watches (a night is two); the die depends on watches and shelter.
 */
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const SYSTEM = "pentra-core-foundry-vtt";
const SETTING = "clocks";
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** Usage checks: 1–2 on the die means an encounter. */
const ENCOUNTER_RANGE = 2;

export const CLOCKS = {
  facility: { dice: [4, 6, 8, 10, 12], segmentMinutes: 10, checkEvery: 3 },
  travel: {
    modes: { walking: 6, driving: 8, boating: 10, flying: 12 },
    // On a 4, land travel meets a creature (like a 1); sea and air travel hit an obstacle (like a 2).
    variable: { walking: 1, driving: 1, boating: 2, flying: 2 }
  },
  camp: { setups: { open: 6, trees: 8, bluff: 10 }, segmentHours: 4 }
};

const DEFAULTS = {
  facility: { die: 8, segments: 0 },
  travel: { mode: "driving", hours: 0 },
  camp: { setup: "trees", hours: 0 }
};

function getState() {
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), game.settings.get(SYSTEM, SETTING) ?? {}, { inplace: false });
}

const saveState = state => game.settings.set(SYSTEM, SETTING, state);

export function registerClockSetting() {
  game.settings.register(SYSTEM, SETTING, {
    scope: "world", config: false, type: Object, default: foundry.utils.deepClone(DEFAULTS),
    onChange: () => PentraClocksApp.refresh()
  });
}

export class PentraClocksApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pentra-clocks",
    classes: ["pentra", "clocks-app"],
    window: { title: "PENTRA.Clock.Title", icon: "fa-solid fa-clock", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      facilityAdvance: PentraClocksApp.#onFacilityAdvance,
      facilityRoll: PentraClocksApp.#onFacilityRoll,
      travelAdvance: PentraClocksApp.#onTravelAdvance,
      campAdvance: PentraClocksApp.#onCampAdvance,
      reset: PentraClocksApp.#onReset
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM}/templates/apps/clocks.hbs` }
  };

  static #instance = null;

  static open() {
    if (!game.user.isGM) return ui.notifications.warn(loc("PENTRA.Clock.GMOnly"));
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  static refresh() {
    if (this.#instance?.rendered) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const state = getState();
    const minutes = state.facility.segments * CLOCKS.facility.segmentMinutes;
    const segmentsToCheck = CLOCKS.facility.checkEvery - (state.facility.segments % CLOCKS.facility.checkEvery);
    return {
      facility: {
        ...state.facility,
        time: formatMinutes(minutes),
        nextCheck: fmt("PENTRA.Clock.Facility.NextCheck", { minutes: segmentsToCheck * CLOCKS.facility.segmentMinutes }),
        dice: Object.fromEntries(CLOCKS.facility.dice.map(d => [d, `d${d} · ${loc(`PENTRA.Clock.Facility.Danger.d${d}`)}`]))
      },
      travel: {
        ...state.travel,
        modes: Object.fromEntries(Object.entries(CLOCKS.travel.modes).map(([k, d]) => [k, `${loc(`PENTRA.Clock.Travel.Mode.${k}`)} (d${d})`]))
      },
      camp: {
        ...state.camp,
        setups: Object.fromEntries(Object.entries(CLOCKS.camp.setups).map(([k, d]) => [k, `${loc(`PENTRA.Clock.Camp.Setup.${k}`)} (d${d})`]))
      }
    };
  }

  /** Selects (danger die, travel mode, camp setup) save as they change. @override */
  _onRender(context, options) {
    super._onRender(context, options);
    for (const select of this.element.querySelectorAll("[data-clock-field]")) {
      select.addEventListener("change", async () => {
        const state = getState();
        const value = select.dataset.dtype === "Number" ? Number(select.value) : select.value;
        foundry.utils.setProperty(state, select.dataset.clockField, value);
        await saveState(state);
      });
    }
  }

  /* ------------------------------------------------------------------------ */

  /** Facility Raid: another 10 minutes. Every third segment (30 minutes), roll the danger die. */
  static async #onFacilityAdvance() {
    const state = getState();
    state.facility.segments += 1;
    await saveState(state);
    const minutes = state.facility.segments * CLOCKS.facility.segmentMinutes;
    if (state.facility.segments % CLOCKS.facility.checkEvery === 0) return facilityCheck(state.facility.die, minutes);
    return whisper(loc("PENTRA.Clock.Facility.Title"), [fmt("PENTRA.Clock.Facility.Passed", { time: formatMinutes(minutes) })]);
  }

  /** Facility Raid: roll the danger die now (e.g. the team made a lot of noise). */
  static #onFacilityRoll() {
    const state = getState();
    return facilityCheck(state.facility.die, state.facility.segments * CLOCKS.facility.segmentMinutes);
  }

  /** Travel: another hour on the road; the mode's usage die, and on 1–2 the d4 encounter type. */
  static async #onTravelAdvance() {
    const state = getState();
    state.travel.hours += 1;
    await saveState(state);
    const mode = state.travel.mode;
    const die = CLOCKS.travel.modes[mode];
    const roll = await new Roll(`1d${die}`).evaluate();
    const rolls = [roll];
    const lines = [fmt("PENTRA.Clock.Travel.Hour", { hours: state.travel.hours, mode: loc(`PENTRA.Clock.Travel.Mode.${mode}`) })];
    if (roll.total <= ENCOUNTER_RANGE) {
      const type = await new Roll("1d4").evaluate();
      rolls.push(type);
      const result = type.total === 4 ? CLOCKS.travel.variable[mode] : type.total;
      lines.push(fmt("PENTRA.Clock.Encounter", { roll: roll.total, die: `d${die}` }));
      lines.push(`<strong>${fmt("PENTRA.Clock.Travel.Type", { roll: type.total, type: loc(`PENTRA.Clock.Travel.Table.${result}`) })}</strong>`);
      if (type.total === 4) lines.push(loc(`PENTRA.Clock.Travel.Variable.${CLOCKS.travel.variable[mode] === 1 ? "land" : "seaAir"}`));
      lines.push(loc(`PENTRA.Clock.Travel.TableHint.${result}`));
    } else {
      lines.push(fmt("PENTRA.Clock.Quiet", { roll: roll.total, die: `d${die}` }));
    }
    return whisper(loc("PENTRA.Clock.Travel.Title"), lines, rolls, roll.total <= ENCOUNTER_RANGE);
  }

  /** Camp: a 4-hour watch (twice for a full night); on 1–2 a creature comes to investigate. */
  static async #onCampAdvance(event, target) {
    const watches = Number(target.dataset.watches) || 1;
    const state = getState();
    const die = CLOCKS.camp.setups[state.camp.setup];
    for (let i = 0; i < watches; i++) {
      state.camp.hours += CLOCKS.camp.segmentHours;
      const roll = await new Roll(`1d${die}`).evaluate();
      const hit = roll.total <= ENCOUNTER_RANGE;
      const lines = [fmt("PENTRA.Clock.Camp.Watch", { hours: state.camp.hours, setup: loc(`PENTRA.Clock.Camp.Setup.${state.camp.setup}`) })];
      lines.push(hit ? fmt("PENTRA.Clock.Encounter", { roll: roll.total, die: `d${die}` }) : fmt("PENTRA.Clock.Quiet", { roll: roll.total, die: `d${die}` }));
      if (hit) lines.push(`<strong>${loc("PENTRA.Clock.Camp.Creature")}</strong>`);
      await whisper(loc("PENTRA.Clock.Camp.Title"), lines, [roll], hit);
    }
    await saveState(state);
  }

  static async #onReset(event, target) {
    const which = target.dataset.clock;
    const state = getState();
    if (which === "facility") state.facility.segments = 0;
    if (which === "travel") state.travel.hours = 0;
    if (which === "camp") state.camp.hours = 0;
    await saveState(state);
  }
}

/** Roll the facility's danger die: 1–2 and something happens. */
async function facilityCheck(die, minutes) {
  const roll = await new Roll(`1d${die}`).evaluate();
  const hit = roll.total <= ENCOUNTER_RANGE;
  const lines = [fmt("PENTRA.Clock.Facility.Check", { time: formatMinutes(minutes) })];
  lines.push(hit ? fmt("PENTRA.Clock.Encounter", { roll: roll.total, die: `d${die}` }) : fmt("PENTRA.Clock.Quiet", { roll: roll.total, die: `d${die}` }));
  if (hit) lines.push(`<strong>${loc("PENTRA.Clock.Facility.Happens")}</strong>`);
  return whisper(loc("PENTRA.Clock.Facility.Title"), lines, [roll], hit);
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** A GM-only chat card with the dice attached. */
async function whisper(title, lines, rolls = [], alert = false) {
  const rollHTML = (await Promise.all(rolls.map(r => r.render()))).join("");
  const content = `<div class="pentra chat-card clock-card ${alert ? "alert" : ""}">
    <header class="card-header"><h3><i class="fa-solid fa-clock"></i> ${title}</h3>
      <span class="subtitle"><i class="fa-solid fa-eye-slash"></i> ${loc("PENTRA.Counter.Private")}</span></header>
    ${rollHTML}
    <ul class="notes">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
  </div>`;
  return ChatMessage.create({
    content, rolls,
    speaker: { alias: loc("PENTRA.Clock.Title") },
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}
