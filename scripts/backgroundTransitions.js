import {
  DEFAULT_BACKGROUND_TRANSITION_MS,
  MODULE_ID
} from "./settings.js";

const SOCKET_EVENT = `module.${MODULE_ID}`;
const REMOTE_TRANSITION_TIMEOUT_MS = 15000;
const transitionQueues = new Map();
const remoteTransitions = new Map();
const completedRemoteTransitions = new Set();
let hooksRegistered = false;

export function getBackgroundTransitionDuration() {
  // Keep using the original storage key so existing client preferences survive
  // the move from the custom renderer to native Scene backgrounds.
  const configured = Number(game.settings.get(MODULE_ID, "tokenLayerTransitionMs"));
  if (!Number.isFinite(configured)) return DEFAULT_BACKGROUND_TRANSITION_MS;
  return Math.min(3000, Math.max(0, Math.round(configured)));
}

function getOwningScene(document) {
  return document?.documentName === "Level" ? document.parent : document;
}

function getActivePrimaryGroup(document) {
  const activeCanvas = globalThis.canvas;
  const scene = getOwningScene(document);
  if (!activeCanvas?.ready || activeCanvas?.scene?.id !== scene?.id) return null;
  if (document?.documentName === "Level" && activeCanvas.level?.id !== document.id) return null;
  return activeCanvas.primary ?? null;
}

function getTextureLoaderClass() {
  return globalThis.foundry?.canvas?.TextureLoader ?? null;
}

async function createTexture(path) {
  const loadTexture = globalThis.foundry?.canvas?.loadTexture;
  if (typeof loadTexture !== "function") {
    throw new Error("Foundry's texture loader is unavailable.");
  }
  return loadTexture(path);
}

function pinTexture(path) {
  const TextureLoaderClass = getTextureLoaderClass();
  if (path && typeof TextureLoaderClass?.pinSource === "function") {
    TextureLoaderClass.pinSource(path);
  }
}

function unpinTexture(path) {
  const TextureLoaderClass = getTextureLoaderClass();
  if (path && typeof TextureLoaderClass?.unpinSource === "function") {
    TextureLoaderClass.unpinSource(path);
  }
}

function createSprite(texture) {
  return new PIXI.Sprite(texture);
}

function disableInteraction(displayObject) {
  displayObject.interactive = false;
  displayObject.interactiveChildren = false;
  displayObject.eventMode = "none";
}

async function startSpriteVideo(sprite) {
  const video = game.video?.getVideoSource?.(sprite) ?? null;
  if (!video || typeof game.video?.play !== "function") return video;

  try {
    await game.video.play(video, {
      playing: true,
      loop: true,
      volume: 0
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not start background transition video`, error);
  }

  return video;
}

function stopVideo(video) {
  if (!video) return;

  try {
    game.video?.stop?.(video);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not stop background transition video`, error);
  }
}

function getSceneRect(scene) {
  const dimensions = globalThis.canvas?.dimensions;
  return dimensions?.sceneRect ?? {
    x: dimensions?.sceneX ?? 0,
    y: dimensions?.sceneY ?? 0,
    width: dimensions?.sceneWidth ?? scene?.width ?? 1,
    height: dimensions?.sceneHeight ?? scene?.height ?? 1
  };
}

function configureSpriteFromBackground(sprite, background, scene) {
  const sceneRect = getSceneRect(scene);
  const width = Math.max(1, Math.abs(Number(background?.width)) || sceneRect.width || 1);
  const height = Math.max(1, Math.abs(Number(background?.height)) || sceneRect.height || 1);
  const anchorX = Number.isFinite(Number(background?.anchor?.x))
    ? Number(background.anchor.x)
    : 0.5;
  const anchorY = Number.isFinite(Number(background?.anchor?.y))
    ? Number(background.anchor.y)
    : 0.5;
  const positionX = Number.isFinite(Number(background?.position?.x))
    ? Number(background.position.x)
    : sceneRect.x + (sceneRect.width / 2);
  const positionY = Number.isFinite(Number(background?.position?.y))
    ? Number(background.position.y)
    : sceneRect.y + (sceneRect.height / 2);
  const scaleSignX = Number(background?.scale?.x) < 0 ? -1 : 1;
  const scaleSignY = Number(background?.scale?.y) < 0 ? -1 : 1;

  sprite.anchor.set(anchorX, anchorY);
  sprite.position.set(positionX, positionY);
  sprite.width = width;
  sprite.height = height;
  sprite.scale.x = Math.abs(sprite.scale.x) * scaleSignX;
  sprite.scale.y = Math.abs(sprite.scale.y) * scaleSignY;
  sprite.rotation = Number(background?.rotation) || 0;

  if (background?.tint !== undefined && background?.tint !== null) {
    sprite.tint = background.tint;
  }
}

function parseBackgroundColor(document) {
  const levelColor = document?.documentName === "Level"
    ? document.background?.color
    : null;
  if (Number.isFinite(Number(levelColor))) return Number(levelColor);

  const color = String(getOwningScene(document)?.backgroundColor || "#000000");
  const parsed = Number.parseInt(color.replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x000000;
}

function configureSolidColorSprite(sprite, document) {
  const dimensions = globalThis.canvas?.dimensions;
  const rect = dimensions?.rect ?? {
    x: 0,
    y: 0,
    width: dimensions?.width ?? 1,
    height: dimensions?.height ?? 1
  };

  sprite.anchor.set(0, 0);
  sprite.position.set(rect.x ?? 0, rect.y ?? 0);
  sprite.width = Math.max(1, Number(rect.width) || 1);
  sprite.height = Math.max(1, Number(rect.height) || 1);
  sprite.tint = parseBackgroundColor(document);
}

function placeAboveNativeBackground(primary, root) {
  const background = primary.background;

  root.name = `${MODULE_ID}.background-transition`;
  root.elevation = Number(background?.elevation)
    || Number(primary.constructor?.BACKGROUND_ELEVATION)
    || 0;
  root.sortLayer = Number(
    background?.sortLayer
    ?? primary.constructor?.SORT_LAYERS?.SCENE
    ?? 0
  );
  root.sort = (Number(background?.sort) || 0) + 1;
  root.zIndex = Number(background?.zIndex) || root.sortLayer;

  primary.addChild(root);
  primary.sortChildren?.();

  if (background?.parent === primary && root.parent === primary) {
    const backgroundIndex = primary.getChildIndex(background);
    const rootIndex = primary.getChildIndex(root);
    if (rootIndex !== backgroundIndex + 1) {
      primary.setChildIndex(root, Math.min(backgroundIndex + 1, primary.children.length - 1));
    }
  }

  primary.renderDirty = true;
}

function destroyOverlay(overlay) {
  if (!overlay?.root) return;

  if (overlay.pinned) unpinTexture(overlay.path);
  stopVideo(overlay.video);

  if (overlay.root.parent) overlay.root.parent.removeChild(overlay.root);
  if (!overlay.root.destroyed) {
    try {
      overlay.root.destroy({
        children: true,
        texture: false,
        baseTexture: false
      });
    } catch {
      overlay.root.destroy({ children: true });
    }
  }

  if (globalThis.canvas?.primary) globalThis.canvas.primary.renderDirty = true;
}

async function createBackgroundOverlay(document, path, primary) {
  const texture = path ? await createTexture(path) : PIXI.Texture.WHITE;
  if (!texture) throw new Error(`Texture loading returned no image for ${path}.`);
  if (getActivePrimaryGroup(document) !== primary) return null;

  const root = new PIXI.Container();
  const overlay = { path, root, video: null, pinned: false };
  root.alpha = 0;
  disableInteraction(root);

  try {
    const sprite = createSprite(texture);
    if (path) {
      configureSpriteFromBackground(sprite, primary.background, getOwningScene(document));
    } else {
      configureSolidColorSprite(sprite, document);
    }
    disableInteraction(sprite);
    root.addChild(sprite);

    if (path) {
      overlay.video = await startSpriteVideo(sprite);
      pinTexture(path);
      overlay.pinned = true;
    }
    placeAboveNativeBackground(primary, root);

    return overlay;
  } catch (error) {
    destroyOverlay(overlay);
    throw error;
  }
}

function nextAnimationFrame(callback) {
  return globalThis.requestAnimationFrame(callback);
}

function animateOverlay(overlay, duration, primary) {
  if (!overlay?.root || overlay.root.destroyed) return Promise.resolve(false);
  if (duration <= 0) {
    overlay.root.alpha = 1;
    primary.renderDirty = true;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startTime = globalThis.performance.now();

    const step = (timestamp) => {
      if (overlay.root.destroyed || overlay.root.parent !== primary) {
        resolve(false);
        return;
      }

      const elapsed = Math.max(0, timestamp - startTime);
      const progress = Math.min(1, elapsed / duration);
      overlay.root.alpha = progress * progress * (3 - (2 * progress));
      primary.renderDirty = true;

      if (progress < 1) nextAnimationFrame(step);
      else resolve(true);
    };

    nextAnimationFrame(step);
  });
}

async function prepareBackgroundTransition(document, path, duration) {
  const primary = duration > 0 ? getActivePrimaryGroup(document) : null;
  if (!primary || !globalThis.PIXI) return null;

  let overlay = null;
  try {
    overlay = await createBackgroundOverlay(document, path, primary);
    if (!overlay) return null;

    const completed = await animateOverlay(overlay, duration, primary);
    if (completed) return overlay;
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not prepare the background fade; updating immediately`, error);
  }

  destroyOverlay(overlay);
  return null;
}

export async function withBackgroundTransition(
  document,
  path,
  operation,
  { duration = getBackgroundTransitionDuration() } = {}
) {
  const overlay = await prepareBackgroundTransition(document, path, duration);
  try {
    return await operation();
  } finally {
    destroyOverlay(overlay);
  }
}

function readBackgroundSourceChange(changes) {
  if (!changes || typeof changes !== "object") return { changed: false, path: null };

  if (Object.prototype.hasOwnProperty.call(changes, "background.src")) {
    return {
      changed: true,
      path: String(changes["background.src"] || "").trim() || null
    };
  }

  if (
    changes.background
    && typeof changes.background === "object"
    && Object.prototype.hasOwnProperty.call(changes.background, "src")
  ) {
    return {
      changed: true,
      path: String(changes.background.src || "").trim() || null
    };
  }

  return { changed: false, path: null };
}

function hasTransitionBypass(options) {
  return options?.[MODULE_ID]?.skipBackgroundTransition === true;
}

function shouldTransition(document, changes, options) {
  if (hasTransitionBypass(options)) return false;

  const { changed, path } = readBackgroundSourceChange(changes);
  if (!changed || path === (String(document?.background?.src || "").trim() || null)) return false;
  return getBackgroundTransitionDuration() > 0 && !!getActivePrimaryGroup(document);
}

function getDocumentKey(document) {
  return `${document?.documentName || "Document"}.${document?.id || "unknown"}`;
}

function enqueueTransition(document, operation) {
  const key = getDocumentKey(document);
  const previous = transitionQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  transitionQueues.set(key, result.catch(() => {}));
  return result;
}

function createTransitionId() {
  return foundry.utils.randomID();
}

function emitTransitionStart(document, path, transitionId, duration) {
  const scene = getOwningScene(document);
  if (!game.socket || !scene?.id) return;

  game.socket.emit(SOCKET_EVENT, {
    type: "startBackgroundTransition",
    transitionId,
    duration,
    sceneId: scene.id,
    documentName: document.documentName,
    documentId: document.id,
    path
  });
}

export function updateBackgroundDocumentWithTransition(document, changes, options = {}) {
  const { changed, path } = readBackgroundSourceChange(changes);
  const currentPath = String(document?.background?.src || "").trim() || null;
  if (!changed || path === currentPath || !shouldTransition(document, changes, options)) {
    return document.update(changes, options);
  }

  return enqueueTransition(document, async () => {
    const duration = getBackgroundTransitionDuration();
    const transitionId = createTransitionId();
    const moduleOptions = {
      ...(options[MODULE_ID] ?? {}),
      skipBackgroundTransition: true,
      backgroundTransitionId: transitionId
    };
    const updateOptions = {
      ...options,
      autoReposition: false,
      [MODULE_ID]: moduleOptions
    };

    emitTransitionStart(document, path, transitionId, duration);
    return withBackgroundTransition(
      document,
      path,
      () => document.update(changes, updateOptions),
      { duration }
    );
  });
}

function cloneChanges(changes) {
  return foundry.utils.deepClone(changes);
}

function interceptBackgroundUpdate(document, changes, options, userId) {
  if (!shouldTransition(document, changes, options)) return undefined;

  const replayChanges = cloneChanges(changes);
  const replayOptions = { ...options, autoReposition: false };
  void updateBackgroundDocumentWithTransition(document, replayChanges, replayOptions)
    .catch((error) => {
      console.error(`${MODULE_ID} | Could not apply the background update`, error);
      if (game.user?.id === userId) {
        ui.notifications.error(`Could not update the background: ${error?.message ?? error}`);
      }
    });

  // The replayed update is awaited behind the transition and carries a bypass
  // marker so this hook does not intercept it a second time.
  return false;
}

function resolveBackgroundDocument(message) {
  const scene = game.scenes?.get(message?.sceneId);
  if (!scene) return null;
  if (message.documentName === "Scene") return scene;
  if (message.documentName === "Level") return scene.levels?.get(message.documentId) ?? null;
  return null;
}

function finishRemoteTransition(transitionId) {
  if (!transitionId) return;

  completedRemoteTransitions.add(transitionId);
  const record = remoteTransitions.get(transitionId);
  if (record) {
    clearTimeout(record.timeoutId);
    destroyOverlay(record.overlay);
    remoteTransitions.delete(transitionId);
  }

  setTimeout(() => completedRemoteTransitions.delete(transitionId), REMOTE_TRANSITION_TIMEOUT_MS);
}

async function startRemoteTransition(message) {
  if (
    message?.type !== "startBackgroundTransition"
    || typeof message.transitionId !== "string"
  ) {
    return;
  }

  const document = resolveBackgroundDocument(message);
  const localDuration = getBackgroundTransitionDuration();
  if (!document || localDuration <= 0 || !getActivePrimaryGroup(document)) return;

  const duration = Math.min(3000, Math.max(0, Number(message.duration) || localDuration));
  const path = String(message.path || "").trim() || null;
  const overlay = await prepareBackgroundTransition(document, path, duration);
  if (!overlay) return;

  if (completedRemoteTransitions.has(message.transitionId)) {
    destroyOverlay(overlay);
    return;
  }

  for (const [transitionId, record] of remoteTransitions) {
    if (record.documentKey !== getDocumentKey(document)) continue;
    finishRemoteTransition(transitionId);
  }

  const timeoutId = setTimeout(
    () => finishRemoteTransition(message.transitionId),
    REMOTE_TRANSITION_TIMEOUT_MS
  );
  remoteTransitions.set(message.transitionId, {
    documentKey: getDocumentKey(document),
    overlay,
    timeoutId
  });
}

function finishTransitionFromUpdate(document, changes, options) {
  const { changed } = readBackgroundSourceChange(changes);
  if (!changed) return;
  finishRemoteTransition(options?.[MODULE_ID]?.backgroundTransitionId);
}

function clearRemoteTransitions() {
  for (const transitionId of Array.from(remoteTransitions.keys())) {
    finishRemoteTransition(transitionId);
  }
}

export function registerBackgroundTransitionHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("preUpdateScene", interceptBackgroundUpdate);
  Hooks.on("preUpdateLevel", interceptBackgroundUpdate);
  Hooks.on("updateScene", finishTransitionFromUpdate);
  Hooks.on("updateLevel", finishTransitionFromUpdate);
  Hooks.on("canvasReady", clearRemoteTransitions);
  game.socket?.on(SOCKET_EVENT, (message) => {
    void startRemoteTransition(message);
  });
}
