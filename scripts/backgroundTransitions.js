import {
  DEFAULT_BACKGROUND_TRANSITION_MS,
  MODULE_ID
} from "./settings.js";

export function getBackgroundTransitionDuration() {
  // Keep using the original storage key so existing client preferences survive
  // the move from the custom renderer to native Scene backgrounds.
  const configured = Number(game.settings.get(MODULE_ID, "tokenLayerTransitionMs"));
  if (!Number.isFinite(configured)) return DEFAULT_BACKGROUND_TRANSITION_MS;
  return Math.min(3000, Math.max(0, Math.round(configured)));
}

function getActivePrimaryGroup(scene) {
  const activeCanvas = globalThis.canvas;
  if (!activeCanvas?.ready || activeCanvas?.scene?.id !== scene?.id) return null;
  return activeCanvas.primary ?? null;
}

function getTextureLoaderClass() {
  return globalThis.foundry?.canvas?.TextureLoader ?? globalThis.TextureLoader ?? null;
}

async function createTexture(path) {
  if (typeof globalThis.foundry?.canvas?.loadTexture === "function") {
    return globalThis.foundry.canvas.loadTexture(path);
  }
  if (typeof globalThis.loadTexture === "function") return globalThis.loadTexture(path);

  const loader = getTextureLoaderClass()?.loader;
  if (typeof loader?.loadTexture === "function") return loader.loadTexture(path);
  if (globalThis.PIXI?.Assets?.load) return globalThis.PIXI.Assets.load(path);
  throw new Error("No compatible texture loader was found.");
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
  const majorVersion = Number.parseInt(String(PIXI.VERSION ?? "7").split(".")[0], 10);
  if (Number.isFinite(majorVersion) && majorVersion >= 8) {
    return new PIXI.Sprite({ texture });
  }
  return new PIXI.Sprite(texture);
}

function disableInteraction(displayObject) {
  displayObject.interactive = false;
  displayObject.interactiveChildren = false;
  if ("eventMode" in displayObject) displayObject.eventMode = "none";
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
    if (typeof game.video?.stop === "function") game.video.stop(video);
    else video.pause?.();
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

  sprite.anchor?.set?.(anchorX, anchorY);
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

async function createBackgroundOverlay(scene, path, primary) {
  const texture = await createTexture(path);
  if (!texture) throw new Error(`Texture loading returned no image for ${path}.`);

  const root = new PIXI.Container();
  const overlay = { path, root, video: null, pinned: false };
  root.alpha = 0;
  disableInteraction(root);

  try {
    const sprite = createSprite(texture);
    configureSpriteFromBackground(sprite, primary.background, scene);
    disableInteraction(sprite);
    root.addChild(sprite);

    overlay.video = await startSpriteVideo(sprite);
    pinTexture(path);
    overlay.pinned = true;
    placeAboveNativeBackground(primary, root);

    return overlay;
  } catch (error) {
    destroyOverlay(overlay);
    throw error;
  }
}

function nextAnimationFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16);
}

function animateOverlay(overlay, duration, primary) {
  if (!overlay?.root || overlay.root.destroyed) return Promise.resolve(false);
  if (duration <= 0) {
    overlay.root.alpha = 1;
    primary.renderDirty = true;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startTime = globalThis.performance?.now?.() ?? Date.now();

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

export async function withBackgroundTransition(scene, path, operation) {
  const duration = getBackgroundTransitionDuration();
  const primary = duration > 0 && path ? getActivePrimaryGroup(scene) : null;
  if (!primary || !globalThis.PIXI) return operation();

  let overlay = null;

  try {
    overlay = await createBackgroundOverlay(scene, path, primary);
    const completed = await animateOverlay(overlay, duration, primary);
    if (!completed) {
      destroyOverlay(overlay);
      overlay = null;
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not prepare the background fade; updating immediately`, error);
    destroyOverlay(overlay);
    overlay = null;
  }

  try {
    return await operation();
  } finally {
    destroyOverlay(overlay);
  }
}
