/**
 * Party window (GM): award Karma or a Resource Die reward to every player character at once.
 */
import * as Rolls from "../rolls.js";
import { formatDie } from "../rules.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const SYSTEM = "pentra-core-foundry-vtt";
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** End-of-session Karma: session complete is always +2; a story arc adds +2 (minor) or +8 (major). */
export const KARMA_SESSION = 2;
export const KARMA_ARCS = { none: 0, minor: 2, major: 8 };

export class PentraPartyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pentra-party",
    classes: ["pentra", "party-app"],
    window: { title: "PENTRA.Party.Title", icon: "fa-solid fa-people-group", resizable: true },
    position: { width: 600, height: "auto" },
    actions: {
      awardKarma: PentraPartyApp.#onAwardKarma,
      rewardResource: PentraPartyApp.#onRewardResource,
      resetEdge: PentraPartyApp.#onResetEdge,
      openSheet: PentraPartyApp.#onOpenSheet,
      selectAll: PentraPartyApp.#onSelectAll
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM}/templates/apps/party.hbs` }
  };

  /** Open (or bring forward) the single Party window. */
  static open() {
    if (!game.user.isGM) return ui.notifications.warn(loc("PENTRA.Party.GMOnly"));
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  static #instance = null;

  /** Re-render if open. */
  static refresh() {
    if (this.#instance?.rendered) this.#instance.render();
  }

  /** Characters left out of the next award (everyone is included by default). */
  #excluded = new Set();

  /** Player-owned Pentra characters. */
  get members() {
    return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get selected() {
    return this.members.filter(a => !this.#excluded.has(a.id));
  }

  /** @override */
  async _prepareContext(options) {
    const members = this.members.map(a => ({
      id: a.id,
      name: a.name,
      img: a.img,
      checked: !this.#excluded.has(a.id),
      edge: a.system.edge.value,
      edgeStart: a.system.edge.start,
      karma: a.system.karma.value,
      earned: a.system.karma.earned,
      resourceDie: formatDie(a.system.resourceDie.value)
    }));
    return {
      members,
      session: KARMA_SESSION,
      arcs: Object.entries(KARMA_ARCS).map(([key, value], i) => ({ key, value, checked: i === 0, label: loc(`PENTRA.Karma.Arc.${key}`) })),
      dice: [4, 6, 8, 10, 12],
      multipliers: [1, 2, 3, 4, 5, 6]
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    // Who's included
    for (const box of root.querySelectorAll("input.member-toggle")) {
      box.addEventListener("change", () => {
        if (box.checked) this.#excluded.delete(box.dataset.actorId);
        else this.#excluded.add(box.dataset.actorId);
      });
    }
    // Live Karma total
    const update = () => {
      const { gm, total } = this.#readKarma();
      root.querySelector(".range-value").textContent = `+${gm}`;
      root.querySelector(".karma-total").textContent = total;
    };
    root.querySelectorAll("[name=arc], [name=gm]").forEach(el => el.addEventListener("input", update));
  }

  #readKarma() {
    const root = this.element;
    const arc = root.querySelector("[name=arc]:checked")?.value ?? "none";
    const gm = Number(root.querySelector("[name=gm]")?.value) || 0;
    return { arc, gm, total: KARMA_SESSION + KARMA_ARCS[arc] + gm };
  }

  /** Award the same end-of-session Karma to everyone selected, with one chat summary. */
  static async #onAwardKarma() {
    const actors = this.selected;
    if (!actors.length) return ui.notifications.warn(loc("PENTRA.Party.NoneSelected"));
    const { arc, gm, total } = this.#readKarma();
    const parts = [`${loc("PENTRA.Karma.Reason.session")} +${KARMA_SESSION}`];
    if (KARMA_ARCS[arc]) parts.push(`${loc(`PENTRA.Karma.Arc.${arc}`)} +${KARMA_ARCS[arc]}`);
    if (gm) parts.push(`${loc("PENTRA.Karma.Reason.misc")} +${gm}`);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("PENTRA.Party.AwardKarma") },
      content: `<p>${fmt("PENTRA.Party.ConfirmKarma", { total, count: actors.length })}</p><p class="hint">${parts.join(", ")}</p>`
    });
    if (!ok) return;
    for (const actor of actors) await actor.awardKarma(total, parts.join(", "), { chat: false });
    const names = actors.map(a => foundry.utils.escapeHTML(a.name)).join(", ");
    await ChatMessage.create({
      content: `<div class="pentra chat-card"><header class="card-header"><h3><i class="fa-solid fa-star"></i> ${fmt("PENTRA.Party.KarmaAwarded", { total })}</h3>
        <span class="subtitle">${parts.join(", ")}</span></header><p>${names}</p></div>`
    });
  }

  /** Roll the same Resource Die reward for each selected character, against their own Resource Die. */
  static async #onRewardResource() {
    const actors = this.selected;
    if (!actors.length) return ui.notifications.warn(loc("PENTRA.Party.NoneSelected"));
    const die = Number(this.element.querySelector("[name=rewardDie]").value);
    const multiplier = Number(this.element.querySelector("[name=rewardMult]").value);
    for (const actor of actors) await Rolls.reward(actor, { die, multiplier });
  }

  static async #onResetEdge() {
    const actors = this.selected;
    if (!actors.length) return ui.notifications.warn(loc("PENTRA.Party.NoneSelected"));
    for (const actor of actors) await actor.startSession();
  }

  static #onOpenSheet(event, target) {
    game.actors.get(target.dataset.actorId)?.sheet.render(true);
  }

  static #onSelectAll() {
    const allIncluded = this.#excluded.size === 0;
    if (allIncluded) this.members.forEach(a => this.#excluded.add(a.id));
    else this.#excluded.clear();
    this.render();
  }
}
