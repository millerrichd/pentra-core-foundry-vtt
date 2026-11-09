/**
 * Counters: the GM sets a counter (1–12, like a d12 on the table), names it, and writes down the condition that ticks
 * it. Because conditions vary, the GM ticks counters by hand with − / +; every change is posted to chat (whispered to
 * the GM for private counters). At 0 the tracked effect happens; a repeating counter then starts over.
 * Players see public counters (read-only) in the same window.
 *
 * The window's second tab runs large-scale battles (see battles.js), which are Army Strength Counters.
 */
import * as Battles from "./battles.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const SYSTEM = "pentra-core-foundry-vtt";
const SETTING = "counters";
const MAX = 12;
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** All counters, from the world setting. */
export function getCounters() {
  return foundry.utils.deepClone(game.settings.get(SYSTEM, SETTING)?.list ?? []);
}

async function saveCounters(list) {
  await game.settings.set(SYSTEM, SETTING, { list });
}

export function registerCounterSetting() {
  game.settings.register(SYSTEM, SETTING, {
    scope: "world", config: false, type: Object, default: { list: [] },
    onChange: () => PentraCountersApp.refresh()
  });
  Battles.registerBattleSetting(() => PentraCountersApp.refresh());
}

export class PentraCountersApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pentra-counters",
    classes: ["pentra", "counters-app"],
    window: { title: "PENTRA.Counter.Title", icon: "fa-solid fa-hourglass-half", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      add: PentraCountersApp.#onAdd,
      step: PentraCountersApp.#onStep,
      reset: PentraCountersApp.#onReset,
      remove: PentraCountersApp.#onRemove,
      switchTab: PentraCountersApp.#onTab,
      battleAdd: () => Battles.addBattle(),
      battleRemove: (event, target) => Battles.removeBattle(battleId(target)),
      battleStart: (event, target) => Battles.startBattle(battleId(target)),
      battleReset: (event, target) => Battles.resetBattle(battleId(target)),
      battleRoll: (event, target) => Battles.rollLeader(battleId(target), sideIndex(target)),
      battleResult: (event, target) => Battles.setResult(battleId(target), sideIndex(target), target.dataset.result),
      battleChoose: (event, target) => Battles.choose(battleId(target), sideIndex(target), target.dataset.choice),
      battleStrength: (event, target) => Battles.adjustStrength(battleId(target), sideIndex(target), Number(target.dataset.delta))
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM}/templates/apps/counters.hbs` }
  };

  static #instance = null;

  /** The open tab: "counters" or "battles". */
  #tab = "counters";

  /** Open (or bring forward) the Counters window, optionally on a tab. */
  static open(tab) {
    this.#instance ??= new this();
    if (tab) this.#instance.#tab = tab;
    return this.#instance.render({ force: true });
  }

  /** Re-render if open (the setting changed, on any client). */
  static refresh() {
    if (this.#instance?.rendered) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const isGM = game.user.isGM;
    const counters = getCounters()
      .filter(c => isGM || c.visible)
      .map(c => ({
        ...c,
        percent: Math.round(100 * c.value / Math.max(c.start, 1)),
        triggered: c.value <= 0,
        canLower: c.value > 0,
        canRaise: c.value < MAX
      }));
    return {
      isGM,
      tab: this.#tab,
      ...Battles.battlesContext(isGM),
      counters,
      startOptions: Object.fromEntries(Array.from({ length: MAX }, (_, i) => [i + 1, String(i + 1)]))
    };
  }

  /** Inline edits (GM): name, condition, starting value, public, repeat. These don't post to chat. @override */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!game.user.isGM) return;
    for (const input of this.element.querySelectorAll("[data-battle-field]")) {
      input.addEventListener("change", () => {
        const side = input.closest("[data-side]")?.dataset.side;
        const field = input.dataset.battleField;
        const value = input.type === "checkbox" ? input.checked : field === "troops" ? Math.max(Number(input.value) || 0, 0) : input.value;
        return Battles.editBattle(battleId(input), side === undefined ? null : Number(side), field, value);
      });
    }
    for (const input of this.element.querySelectorAll("[data-counter-field]")) {
      input.addEventListener("change", async () => {
        const list = getCounters();
        const counter = list.find(c => c.id === input.closest("[data-counter-id]").dataset.counterId);
        if (!counter) return;
        const field = input.dataset.counterField;
        const value = input.type === "checkbox" ? input.checked : field === "start" ? Number(input.value) : input.value;
        counter[field] = value;
        // A fresh counter (not yet ticked) follows its new starting value.
        if (field === "start" && !counter.ticked) counter.value = value;
        await saveCounters(list);
      });
    }
  }

  /* ------------------------------------------------------------------------ */

  static async #onAdd() {
    const list = getCounters();
    list.push({
      id: foundry.utils.randomID(), name: loc("PENTRA.Counter.NewName"), condition: "",
      // New counters start private, so the GM can set them up before the players see them.
      start: 6, value: 6, visible: false, repeat: false, ticked: false
    });
    await saveCounters(list);
  }

  static #onTab(event, target) {
    this.#tab = target.dataset.tab;
    this.render();
  }

  static async #onStep(event, target) {
    const id = target.closest("[data-counter-id]")?.dataset.counterId;
    return stepCounter(id, Number(target.dataset.delta));
  }

  static async #onReset(event, target) {
    const list = getCounters();
    const counter = list.find(c => c.id === target.closest("[data-counter-id]")?.dataset.counterId);
    if (!counter) return;
    const from = counter.value;
    counter.value = counter.start;
    counter.ticked = false;
    await saveCounters(list);
    return announce(counter, [fmt("PENTRA.Counter.ResetTo", { from, to: counter.start })]);
  }

  static async #onRemove(event, target) {
    const list = getCounters();
    const counter = list.find(c => c.id === target.closest("[data-counter-id]")?.dataset.counterId);
    if (!counter) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Counter.Remove") },
      content: `<p>${fmt("PENTRA.Counter.RemoveConfirm", { name: esc(counter.name) })}</p>`
    });
    if (!ok) return;
    await saveCounters(list.filter(c => c.id !== counter.id));
  }
}

const battleId = el => el.closest("[data-battle-id]")?.dataset.battleId;
const sideIndex = el => Number(el.closest("[data-side]")?.dataset.side);

/**
 * Tick a counter up or down by one (GM). Posts the change; reaching 0 triggers the effect, and a repeating
 * counter starts again from its starting value.
 */
export async function stepCounter(id, delta) {
  if (!game.user.isGM) return;
  const list = getCounters();
  const counter = list.find(c => c.id === id);
  if (!counter) return;
  const from = counter.value;
  const to = Math.clamp(from + delta, 0, MAX);
  if (to === from) return;
  counter.value = to;
  counter.ticked = true;
  const lines = [fmt("PENTRA.Counter.Changed", { from, to })];
  if (to === 0) {
    lines.push(fmt("PENTRA.Counter.Triggered", { name: esc(counter.name) }));
    if (counter.repeat) {
      counter.value = counter.start;
      counter.ticked = false;
      lines.push(fmt("PENTRA.Counter.Restarts", { start: counter.start }));
    }
  }
  await saveCounters(list);
  return announce(counter, lines, to === 0);
}

/** Post a counter update: to everyone for public counters, whispered to the GM for private ones. */
async function announce(counter, lines, triggered = false) {
  const condition = counter.condition ? `<p class="hint"><i class="fa-solid fa-circle-info"></i> ${esc(counter.condition)}</p>` : "";
  const content = `<div class="pentra chat-card counter-card ${triggered ? "triggered" : ""}">
    <header class="card-header"><h3><i class="fa-solid fa-hourglass-half"></i> ${esc(counter.name)}</h3>
      ${counter.visible ? "" : `<span class="subtitle"><i class="fa-solid fa-eye-slash"></i> ${loc("PENTRA.Counter.Private")}</span>`}</header>
    <ul class="notes">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
    ${condition}
  </div>`;
  const data = { content, speaker: { alias: loc("PENTRA.Counter.Title") } };
  if (!counter.visible) data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  return ChatMessage.create(data);
}
