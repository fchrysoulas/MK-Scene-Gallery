import { MODULE_ID } from "./settings.js";
import { getBackgroundTransitionDuration, getBackgroundTransitionEffect } from "./backgroundTransitions.js";
import { createTransitionFilter, normalizeTransitionEffect, setTransitionProgress } from "./transitionEffects.js";

const SOCKET_EVENT = `module.${MODULE_ID}`;
const TRANSITION_TIMEOUT_MS = 40000;
const transitions = new Map();
let hooksRegistered = false;
let activationQueue = Promise.resolve();

function destroyTransition(record) {
  if (!record || record.destroyed) return;
  record.destroyed = true;
  clearTimeout(record.timeoutId);
  if (record.frameId) cancelAnimationFrame(record.frameId);
  transitions.delete(record.id);
  try {
    record.sprite.filters = null;
    record.filter?.destroy();
    record.application.destroy(true, { children: true, texture: true, baseTexture: true });
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not clean up the Scene transition`, error);
    record.application.view?.remove();
  } finally {
    record.resolve();
  }
}

// Adapted from Battle Transitions' createSnapshot. The independent overlay
// renderer survives Foundry tearing down the outgoing Scene's canvas objects.
function createSceneSnapshot() {
  const activeCanvas = globalThis.canvas;
  const renderer = activeCanvas?.app?.renderer;
  if (!activeCanvas?.ready || !renderer || !activeCanvas.stage || !globalThis.PIXI) return null;
  const width = Math.max(1, Math.round(renderer.screen.width));
  const height = Math.max(1, Math.round(renderer.screen.height));
  const texture = PIXI.RenderTexture.create({ width, height, resolution: 1 });
  try {
    renderer.render(activeCanvas.stage, { renderTexture: texture, skipUpdateTransform: true, clear: true });
    const snapshot = renderer.extract.canvas(texture);
    const context = snapshot.getContext("2d");
    if (!context) throw new Error("Could not create a Scene transition snapshot.");
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);
    return snapshot;
  } finally {
    texture.destroy(true);
  }
}

function prepareSceneTransition(id, sceneId, effect) {
  const duration = getBackgroundTransitionDuration();
  if (duration <= 0 || effect === "none" || globalThis.document?.hidden
    || globalThis.canvas?.scene?.id === sceneId) return null;
  // Only one screen cover can be visible on this client.
  for (const record of transitions.values()) destroyTransition(record);
  let application;
  let filter;
  try {
    const snapshot = createSceneSnapshot();
    if (!snapshot) return null;
    application = new PIXI.Application({
      width: snapshot.width, height: snapshot.height, resolution: 1,
      backgroundAlpha: 0, autoStart: false, antialias: false
    });
    const sprite = new PIXI.Sprite(PIXI.Texture.from(snapshot));
    sprite.eventMode = "none";
    application.stage.addChild(sprite);
    try {
      filter = createTransitionFilter(effect);
      if (filter) sprite.filters = [filter];
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not create ${effect}; using Fade`, error);
    }
    setTransitionProgress(sprite, filter, 1);
    application.view.classList.add("mg-scene-transition");
    application.view.setAttribute("aria-hidden", "true");
    application.renderer.render(application.stage);
    document.body.appendChild(application.view);
    let resolve;
    const done = new Promise((complete) => { resolve = complete; });
    const record = {
      id, sceneId, application, sprite, filter, duration, resolve, done,
      completeRequested: false, revealing: false, destroyed: false
    };
    record.timeoutId = setTimeout(() => destroyTransition(record), TRANSITION_TIMEOUT_MS);
    transitions.set(id, record);
    return record;
  } catch (error) {
    filter?.destroy();
    application?.destroy(true, { children: true, texture: true, baseTexture: true });
    console.warn(`${MODULE_ID} | Could not prepare the Scene transition; switching immediately`, error);
    return null;
  }
}

function revealScene(record) {
  if (!record || record.destroyed || record.revealing || !record.completeRequested) return;
  const activeCanvas = globalThis.canvas;
  if (!activeCanvas?.ready || activeCanvas.scene?.id !== record.sceneId) return;
  record.revealing = true;
  const start = performance.now();
  const step = (timestamp) => {
    if (record.destroyed) return;
    try {
      const progress = Math.min(1, Math.max(0, (timestamp - start) / record.duration));
      const eased = progress * progress * (3 - 2 * progress);
      setTransitionProgress(record.sprite, record.filter, 1 - eased);
      record.application.renderer.render(record.application.stage);
      if (progress >= 1) destroyTransition(record);
      else record.frameId = requestAnimationFrame(step);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not render the Scene transition`, error);
      destroyTransition(record);
    }
  };
  record.frameId = requestAnimationFrame(step);
}

function emitSceneTransition(type, id, sceneId, effect, cancelled = false) {
  game.socket?.emit(SOCKET_EVENT, { type, transitionId: id, sceneId, effect, cancelled, userId: game.user.id });
}

export async function withSceneTransition(scene, operation) {
  if (!game.user?.isGM) throw new Error("Only Game Masters can activate a Scene transition.");
  const effect = getBackgroundTransitionEffect();
  const id = foundry.utils.randomID();
  const record = prepareSceneTransition(id, scene.id, effect);
  // Players may have effects enabled even if this GM disables them locally.
  let completed = false;
  try {
    emitSceneTransition("prepareSceneTransition", id, scene.id, effect);
    const result = await operation();
    completed = true;
    emitSceneTransition("finishSceneTransition", id, scene.id, effect);
    if (record) {
      record.completeRequested = true;
      revealScene(record);
      await record.done;
    }
    return result;
  } finally {
    if (!completed) emitSceneTransition("finishSceneTransition", id, scene.id, effect, true);
    destroyTransition(record);
  }
}

export function activateSceneWithTransition(sceneOrId) {
  const operation = async () => {
    const scene = typeof sceneOrId === "string" ? game.scenes.get(sceneOrId) : sceneOrId;
    if (!scene) throw new Error("The selected Foundry Scene no longer exists.");
    return withSceneTransition(scene, async () => {
      await scene.activate();
      await scene.view();
      return scene;
    });
  };
  const result = activationQueue.then(operation, operation);
  activationQueue = result.catch(() => {});
  return result;
}

export function registerSceneTransitionHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("canvasReady", () => {
    for (const record of transitions.values()) revealScene(record);
  });
  game.socket?.on(SOCKET_EVENT, (message) => {
    if (!message || !["prepareSceneTransition", "finishSceneTransition"].includes(message.type)) return;
    if (typeof message.transitionId !== "string" || typeof message.sceneId !== "string") return;
    if (!game.users?.get(message.userId)?.isGM || message.userId === game.user.id) return;
    // Other GMs keep their own viewed Scene when a Scene is activated.
    if (game.user.isGM) return;
    if (message.type === "prepareSceneTransition") {
      if (!game.scenes?.get(message.sceneId)) return;
      prepareSceneTransition(message.transitionId, message.sceneId, normalizeTransitionEffect(message.effect));
      return;
    }
    const record = transitions.get(message.transitionId);
    if (!record || record.sceneId !== message.sceneId) return;
    if (message.cancelled) destroyTransition(record);
    else {
      record.completeRequested = true;
      revealScene(record);
    }
  });
}
