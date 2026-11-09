/**
 * GM conveniences in Foundry's core UI.
 *  - Players list (lower left): each player's Edge next to their name; right-click to reset it to their limit.
 */
import { PentraPartyApp } from "./apps/party.js";
import { PentraCountersApp } from "./apps/counters.js";
import { PentraChaseApp } from "./apps/chase-app.js";
import { PentraClocksApp } from "./apps/clocks.js";

const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** The Pentra character assigned to a user (User Configuration → Character), if any. */
function characterFor(user) {
  const actor = user?.character;
  return actor?.type === "character" ? actor : null;
}

/** Show "⚡ Edge" beside each player who has a character assigned. */
function onRenderPlayers(app, html) {
  for (const li of html.querySelectorAll("li.player[data-user-id]")) {
    const actor = characterFor(game.users.get(li.dataset.userId));
    if (!actor || li.querySelector(".pentra-edge")) continue;
    const { value, start } = actor.system.edge;
    const tag = document.createElement("span");
    tag.className = "pentra-edge";
    if (value < start) tag.classList.add("low");
    tag.innerHTML = `<i class="fa-solid fa-bolt"></i> ${value}`;
    tag.dataset.tooltipText = fmt("PENTRA.Players.EdgeTooltip", { name: actor.name, value, start, max: actor.system.edge.max });
    li.querySelector(".player-name")?.after(tag);
  }
}

/** Right-click menu entry: reset this player's Edge to their starting limit (GM only). */
function onGetUserContextOptions(app, options) {
  options.push({
    label: "PENTRA.Players.ResetEdge",
    icon: "fa-solid fa-bolt",
    visible: li => game.user.isGM && !!characterFor(game.users.get(li.dataset.userId)),
    onClick: (event, li) => characterFor(game.users.get(li.dataset.userId))?.startSession()
  });
  options.push({
    label: "PENTRA.Party.Title",
    icon: "fa-solid fa-people-group",
    visible: () => game.user.isGM,
    onClick: () => PentraPartyApp.open()
  });
  options.push({
    label: "PENTRA.Players.ResetAllEdge",
    icon: "fa-solid fa-bolt-lightning",
    visible: () => game.user.isGM,
    onClick: () => resetAllEdge()
  });
}

/** Reset every player character's Edge to its starting value (start of a new session). */
async function resetAllEdge() {
  const actors = new Set(game.users.filter(u => !u.isGM).map(characterFor).filter(Boolean));
  for (const actor of actors) await actor.startSession();
  if (!actors.size) ui.notifications.info(loc("PENTRA.Players.NoCharacters"));
}

/** Keep the Players list current when a player character's Edge changes or characters are reassigned. */
/** Buttons at the top of the Actors sidebar: Party and Clocks (GM only), Counters and Chase (everyone; players see what's public). */
function onRenderActorDirectory(app, html) {
  // Players who can't create actors may not get the header actions row; fall back to the directory header.
  const actions = html.querySelector(".header-actions") ?? html.querySelector(".directory-header");
  if (!actions) return;
  const add = (cls, icon, label, onClick) => {
    if (html.querySelector(`.${cls}`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = cls;
    button.innerHTML = `<i class="fa-solid ${icon}" inert></i> <span>${loc(label)}</span>`;
    button.addEventListener("click", onClick);
    actions.append(button);
  };
  if (game.user.isGM) add("pentra-party-btn", "fa-people-group", "PENTRA.Party.Title", () => PentraPartyApp.open());
  if (game.user.isGM) add("pentra-clocks-btn", "fa-clock", "PENTRA.Clock.Title", () => PentraClocksApp.open());
  add("pentra-counters-btn", "fa-hourglass-half", "PENTRA.Counter.Title", () => PentraCountersApp.open());
  add("pentra-chase-btn", "fa-car-burst", "PENTRA.Chase.Title", () => PentraChaseApp.open());
}

function onUpdateActor(actor, changed) {
  if (actor.type === "character") PentraPartyApp.refresh();
  if (!foundry.utils.hasProperty(changed, "system.edge")) return;
  if (game.users.some(u => u.character?.id === actor.id)) ui.players?.render();
}

function onUpdateUser(user, changed) {
  if ("character" in changed) ui.players?.render();
}

export function registerGMTools() {
  Hooks.on("renderPlayers", onRenderPlayers);
  Hooks.on("getUserContextOptions", onGetUserContextOptions);
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("updateUser", onUpdateUser);
  Hooks.on("renderActorDirectory", onRenderActorDirectory);
  for (const hook of ["createActor", "deleteActor"]) Hooks.on(hook, () => PentraPartyApp.refresh());
}
