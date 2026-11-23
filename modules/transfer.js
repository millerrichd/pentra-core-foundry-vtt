/**
 * Handing gear between characters: armor, weapons and field kits move from one character (or NPC) to another
 * without being bought again or duplicated. The item keeps everything about it (durability, usage, flags such as a
 * setting's enchantment). When the user doesn't own both sides, the active GM's client makes the move.
 */
import { PURCHASED_TYPES } from "./documents.js";

const SYSTEM = "pentra-core-foundry-vtt";
const SOCKET = `system.${SYSTEM}`;
const loc = key => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Characters and NPCs can hold gear. */
const holds = actor => actor instanceof Actor && ["character", "npc"].includes(actor.type);

/** Can this item be handed from its actor to the target at all (ignoring who is asking)? */
export function transferable(item, target) {
  const source = item?.parent;
  return PURCHASED_TYPES.includes(item?.type) && holds(source) && holds(target) && source !== target && !source.pack && !target.pack;
}

/**
 * Move an item to another actor. Runs directly if the user owns both actors, otherwise asks the active GM.
 * The user must own at least one side (give from your own sheet, or take onto it).
 * @returns {Promise<Item|null|void>}
 */
export async function transferItem(item, target) {
  if (!transferable(item, target)) return null;
  const source = item.parent;
  if (!source.isOwner && !target.isOwner) {
    ui.notifications.warn(fmt("PENTRA.Transfer.NotYours", { item: item.name }));
    return null;
  }
  if (source.isOwner && target.isOwner) return moveItem(item, target, game.user);
  if (!game.users.activeGM) {
    ui.notifications.warn(loc("PENTRA.Transfer.NeedGM"));
    return null;
  }
  const request = { scope: "transfer", userId: game.user.id, itemUuid: item.uuid, targetUuid: target.uuid };
  if (game.users.activeGM.isSelf) return handleRequest(request);
  game.socket.emit(SOCKET, request);
}

/** Create the copy on the target, then remove the original: one item, never two and never bought again. */
async function moveItem(item, target, user) {
  const source = item.parent;
  const data = item.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  const [created] = await target.createEmbeddedDocuments("Item", [data], { pentraBypass: true, pentraTransfer: true });
  if (!created) return null;
  await item.delete({ pentraBypass: true, pentraTransfer: true });
  const by = user.character && ![source, target].includes(user.character) ? user.character.name : null;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target.isOwner ? target : source }),
    content: `<p><i class="fa-solid fa-hand-holding"></i> ${esc(fmt("PENTRA.Transfer.Moved", { item: created.name, from: source.name, to: target.name }))}${by ? ` <span class="hint">(${esc(by)})</span>` : ""}</p>`
  });
  return created;
}

/** Active GM only: make a move a player asked for, if they own one side of it. */
async function handleRequest({ scope, userId, itemUuid, targetUuid }) {
  if (scope !== "transfer" || !game.users.activeGM?.isSelf) return;
  const user = game.users.get(userId);
  const item = await fromUuid(itemUuid);
  const target = await fromUuid(targetUuid);
  if (!user || !item || !transferable(item, target)) return;
  if (!item.parent.testUserPermission(user, "OWNER") && !target.testUserPermission(user, "OWNER")) return;
  return moveItem(item, target, user);
}

export function registerTransferSocket() {
  game.socket.on(SOCKET, handleRequest);
}

/** The characters an item can be given to: other player characters (and anything else the user owns). */
export function giveTargets(item) {
  return game.actors.filter(a => holds(a) && a !== item.parent && (a.isOwner || (a.type === "character" && a.hasPlayerOwner)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Give to…": pick who gets the item. */
export async function giveDialog(item) {
  const targets = giveTargets(item);
  if (!targets.length) return ui.notifications.warn(loc("PENTRA.Transfer.NoOne"));
  const { DialogV2 } = foundry.applications.api;
  const options = targets.map(a => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("");
  const uuid = await DialogV2.prompt({
    window: { title: fmt("PENTRA.Transfer.GiveTitle", { item: item.name }), icon: "fa-solid fa-hand-holding" },
    content: `<div class="form-group"><label>${esc(loc("PENTRA.Transfer.To"))}</label><select name="giveTarget">${options}</select></div>
      <p class="hint">${esc(loc("PENTRA.Transfer.Hint"))}</p>`,
    ok: {
      label: loc("PENTRA.Transfer.Give"), icon: "fa-solid fa-hand-holding",
      callback: (event, button) => button.form.elements.namedItem("giveTarget").value
    },
    rejectClose: false
  });
  if (!uuid) return null;
  return transferItem(item, fromUuidSync(uuid));
}
