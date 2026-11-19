import { MODULE_ID } from "./settings.js";
import { getSceneBackgroundDocument } from "./sceneBackground.js";

const TOKEN_FLAG = "sceneMapToken";

// A saved token is a template, never an embedded document with its own identity.
export function cleanSceneMapToken(data) {
  const copy = foundry.utils.deepClone(data);
  for (const key of ["_id", "_stats", "_movementHistory", "_regions", "level"]) delete copy[key];
  if (copy.flags?.[MODULE_ID]) delete copy.flags[MODULE_ID][TOKEN_FLAG];
  return copy;
}

export function getSceneMapTokenSource(token) {
  return token.flags?.[MODULE_ID]?.[TOKEN_FLAG];
}

export async function makeSceneMapAttachment(data) {
  const document = await foundry.utils.fromUuid(data.uuid);
  const token = document?.documentName === "Token" ? document : document?.token;
  const actor = token?.baseActor ?? token?.actor ?? document;
  if (actor?.documentName !== "Actor") throw new Error("Drop an Actor or a Token with an Actor.");
  return {
    id: foundry.utils.randomID(),
    actorUuid: actor.uuid,
    sourceTokenUuid: token?.uuid ?? "",
    name: token?.name || actor.name,
    img: token?.texture?.src || actor.prototypeToken?.texture?.src || actor.img || "",
    tokenData: token ? cleanSceneMapToken(token.toObject()) : null
  };
}

async function resolveActor(uuid) {
  let actor = await foundry.utils.fromUuid(uuid);
  if (actor?.documentName !== "Actor") throw new Error(`Attached Actor no longer exists: ${uuid}`);
  if (actor.inCompendium) {
    actor = game.actors.find((entry) => entry._stats?.compendiumSource === uuid
      || entry.getFlag("core", "sourceId") === uuid)
      ?? await Actor.implementation.create(game.actors.fromCompendium(actor), { fromCompendium: true });
  }
  if (!actor || !game.actors.has(actor.id)) throw new Error(`Cannot use attached Actor: ${uuid}`);
  return actor;
}

function initialPosition(scene, data, index) {
  const bounds = scene.dimensions ?? scene.getDimensions();
  const grid = Number(scene.grid?.size) || 100;
  const width = Math.max(grid, Number(data.width || 1) * grid);
  const height = Math.max(grid, Number(data.height || 1) * grid);
  const left = Number(bounds.sceneX) || 0;
  const top = Number(bounds.sceneY) || 0;
  const sceneWidth = Number(bounds.sceneWidth ?? scene.width) || width;
  const sceneHeight = Number(bounds.sceneHeight ?? scene.height) || height;
  // Arrange new Actors near the center, keeping their full footprint in bounds.
  const x = left + sceneWidth / 2 + (index % 4 - 2) * width;
  const y = top + sceneHeight / 2 + Math.floor(index / 4) * height;
  return {
    x: Math.round(Math.max(left, Math.min(left + sceneWidth - width, x))),
    y: Math.round(Math.max(top, Math.min(top + sceneHeight - height, y)))
  };
}

export async function loadSceneMapTokens(scene, mapId, node) {
  if (!game.user?.isGM || !scene?.isOwner) throw new Error("You cannot place tokens on this Scene.");
  const existing = Array.from(scene.tokens ?? []);
  const attachments = node.tokens ?? [];
  const pending = [];
  const actors = new Map();
  for (const [index, attachment] of attachments.entries()) {
    // Revisiting preserves tokens already on this node, including moves and Actor changes.
    if (existing.some((token) => {
      const source = getSceneMapTokenSource(token);
      return (source?.mapId === mapId && source?.nodeId === node.id && source?.id === attachment.id)
        || (!source && token.uuid === attachment.sourceTokenUuid);
    })) continue;
    if (!actors.has(attachment.actorUuid)) actors.set(attachment.actorUuid, await resolveActor(attachment.actorUuid));
    const actor = actors.get(attachment.actorUuid);
    const document = await actor.getTokenDocument(attachment.tokenData ?? {}, { parent: scene });
    const data = cleanSceneMapToken(document.toObject());
    data.actorId = actor.id;
    if (!attachment.tokenData) Object.assign(data, initialPosition(scene, data, index));
    if (Number(game.release?.generation) >= 14) data.level = getSceneBackgroundDocument(scene)?.id;
    data.flags ??= {};
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][TOKEN_FLAG] = { mapId, nodeId: node.id, id: attachment.id };
    pending.push(data);
  }
  // Prepare and create before removing old tokens so an invalid attachment cannot clear a Scene.
  if (pending.length) {
    const created = await scene.createEmbeddedDocuments("Token", pending);
    if (created.length !== pending.length) throw new Error("Some attached tokens could not be created. Previous tokens were kept.");
  }
  const stale = existing.filter((token) => {
    const source = getSceneMapTokenSource(token);
    return source && (source.mapId !== mapId || source.nodeId !== node.id
      || !attachments.some((attachment) => attachment.id === source.id));
  });
  if (stale.length) await scene.deleteEmbeddedDocuments("Token", stale.map((token) => token.id));
}
