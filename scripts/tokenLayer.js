import { MODULE_ID } from "./settings.js";
import {
  animateAlpha,
  getTokenLayerTransitionDuration
} from "./transitions.js";

const FLAG_KEY = "tokenLayerImage";
const locallyUpdatedScenes = new Set();
let tokenLayerMutationQueue = Promise.resolve();

function getActiveScene() {
  return game.canvas?.scene
    ?? globalThis.canvas?.scene
    ?? game.scenes?.viewed
    ?? game.scenes?.current
    ?? game.scenes?.active
    ?? null;
}

function isSceneCanvasReady(scene, activeCanvas = globalThis.canvas) {
  return !!activeCanvas?.ready && activeCanvas?.scene?.id === scene?.id;
}

function waitForSceneCanvasReady(scene, timeoutMs = 15000) {
  if (isSceneCanvasReady(scene)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let hookId = null;
    let timer = null;

    const finish = (ready) => {
      if (settled) return;
      settled = true;
      if (hookId !== null) Hooks.off("canvasReady", hookId);
      if (timer !== null) clearTimeout(timer);
      resolve(ready);
    };

    hookId = Hooks.on("canvasReady", (activeCanvas) => {
      if (isSceneCanvasReady(scene, activeCanvas)) finish(true);
    });
    timer = setTimeout(() => finish(false), timeoutMs);

    // Cover the small race where the canvas became ready before the Hook was registered.
    if (isSceneCanvasReady(scene)) finish(true);
  });
}

function getImageLabel(path) {
  const fileName = String(path || "").split("/").pop() || "Gallery image";

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function disableInteraction(displayObject) {
  displayObject.interactive = false;
  displayObject.interactiveChildren = false;
  if ("eventMode" in displayObject) displayObject.eventMode = "none";
}

function destroyDisplayObject(displayObject) {
  if (!displayObject) return;
  if (displayObject.parent) displayObject.parent.removeChild(displayObject);

  try {
    displayObject.destroy({
      children: true,
      texture: false,
      baseTexture: false
    });
  } catch {
    displayObject.destroy({ children: true });
  }
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

function getTextureLoaderClass() {
  return globalThis.foundry?.canvas?.TextureLoader ?? globalThis.TextureLoader ?? null;
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

async function expireUnusedTextures(excludePath = "") {
  const loader = getTextureLoaderClass()?.loader;
  if (typeof loader?.expireCache !== "function") return;

  try {
    const options = game.release?.generation >= 13 && excludePath
      ? { exclude: new Set([excludePath]) }
      : undefined;
    await loader.expireCache(options);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not expire unused textures`, error);
  }
}

async function withLocalSceneUpdate(scene, operation) {
  locallyUpdatedScenes.add(scene.id);
  try {
    return await operation();
  } finally {
    await Promise.resolve();
    locallyUpdatedScenes.delete(scene.id);
  }
}

function enqueueTokenLayerMutation(operation) {
  const result = tokenLayerMutationQueue.then(operation, operation);
  tokenLayerMutationQueue = result.catch(() => {});
  return result;
}

function createSprite(texture) {
  const majorVersion = Number.parseInt(String(PIXI.VERSION ?? "7").split(".")[0], 10);
  if (Number.isFinite(majorVersion) && majorVersion >= 8) {
    return new PIXI.Sprite({ texture });
  }
  return new PIXI.Sprite(texture);
}

function getTextureSize(texture, fallbackWidth, fallbackHeight) {
  return {
    width: Math.max(1, texture?.width || texture?.orig?.width || fallbackWidth || 1),
    height: Math.max(1, texture?.height || texture?.orig?.height || fallbackHeight || 1)
  };
}

class SceneGalleryTokenLayerRenderer {
  constructor() {
    this.root = null;
    this.sceneId = null;
    this.texturePath = "";
    this.drawGeneration = 0;
    this.sortScheduled = false;
  }

  async draw(scene = getActiveScene(), {
    throwOnError = false,
    notifyOnError = true,
    animate = true
  } = {}) {
    if (!scene || !globalThis.PIXI) {
      const error = new Error("The Foundry canvas is unavailable.");
      if (throwOnError) throw error;
      return false;
    }

    if (!isSceneCanvasReady(scene)) {
      const ready = await waitForSceneCanvasReady(scene);
      if (!ready) {
        const error = new Error("The Foundry canvas did not become ready in time.");
        if (throwOnError) throw error;
        if (notifyOnError && game.user?.isGM) {
          ui.notifications.error(error.message);
        }
        return false;
      }
    }

    const generation = ++this.drawGeneration;
    const transitionDuration = animate ? getTokenLayerTransitionDuration() : 0;

    const image = scene.getFlag(MODULE_ID, FLAG_KEY);
    if (!image?.path) {
      const previousRoot = this.root;
      const previousTexturePath = this.texturePath;
      if (previousRoot) {
        await animateAlpha(
          previousRoot,
          0,
          transitionDuration,
          () => generation === this.drawGeneration
        );
        if (generation !== this.drawGeneration) return false;
        unpinTexture(previousTexturePath);
        destroyDisplayObject(previousRoot);
        if (this.root === previousRoot) {
          this.root = null;
          this.sceneId = null;
          this.texturePath = "";
        }
      }
      await expireUnusedTextures();
      return false;
    }

    const primary = canvas.primary;
    if (!primary) {
      const error = new Error("The Foundry primary canvas group is unavailable.");
      if (throwOnError) throw error;
      return false;
    }

    const dimensions = canvas.dimensions;
    const sceneRect = dimensions?.sceneRect ?? {
      x: dimensions?.sceneX ?? 0,
      y: dimensions?.sceneY ?? 0,
      width: dimensions?.sceneWidth ?? scene.width,
      height: dimensions?.sceneHeight ?? scene.height
    };

    let nextRoot = null;

    try {
      const texture = await createTexture(image.path);
      if (generation !== this.drawGeneration) {
        const error = new Error("Token Layer rendering was superseded by a newer update.");
        if (throwOnError) throw error;
        return false;
      }
      if (!texture) throw new Error(`Texture loading returned no image for ${image.path}.`);

      const targetAlpha = Number.isFinite(Number(image.opacity)) ? Number(image.opacity) : 1;
      nextRoot = new PIXI.Container();
      nextRoot.name = `${MODULE_ID}.token-layer`;
      nextRoot.alpha = transitionDuration > 0 ? 0 : targetAlpha;
      nextRoot.elevation = 0;
      nextRoot.sortLayer = Number(primary.constructor?.SORT_LAYERS?.TOKENS ?? 700);
      nextRoot.sort = Number.MIN_SAFE_INTEGER;
      nextRoot.zIndex = nextRoot.sortLayer;
      disableInteraction(nextRoot);

      const sprite = createSprite(texture);
      const textureSize = getTextureSize(texture, sceneRect.width, sceneRect.height);
      const coverScale = Math.max(
        sceneRect.width / textureSize.width,
        sceneRect.height / textureSize.height
      );

      if (sprite.anchor?.set) sprite.anchor.set(0.5, 0.5);
      sprite.scale.set(coverScale, coverScale);
      sprite.position.set(
        sceneRect.x + (sceneRect.width / 2),
        sceneRect.y + (sceneRect.height / 2)
      );
      disableInteraction(sprite);

      nextRoot.addChild(sprite);

      const previousRoot = this.root;
      const previousTexturePath = this.texturePath;

      primary.addChild(nextRoot);
      primary.sortChildren?.();
      primary.renderDirty = true;

      this.root = nextRoot;
      this.sceneId = scene.id;
      this.texturePath = image.path;
      pinTexture(this.texturePath);
      this.ensureTokenArtworkAboveImage();

      if (previousRoot) {
        await Promise.all([
          animateAlpha(
            previousRoot,
            0,
            transitionDuration,
            () => generation === this.drawGeneration
          ),
          animateAlpha(
            nextRoot,
            targetAlpha,
            transitionDuration,
            () => generation === this.drawGeneration
          )
        ]);

        if (previousTexturePath !== image.path) unpinTexture(previousTexturePath);
        destroyDisplayObject(previousRoot);
      } else {
        await animateAlpha(
          nextRoot,
          targetAlpha,
          transitionDuration,
          () => generation === this.drawGeneration
        );
      }

      if (generation !== this.drawGeneration) return false;

      await expireUnusedTextures(this.texturePath);
      return true;
    } catch (error) {
      if (nextRoot && nextRoot !== this.root) destroyDisplayObject(nextRoot);
      console.error(`${MODULE_ID} | Could not render Token Layer image`, error);
      if (throwOnError) throw error;
      if (notifyOnError && game.user?.isGM) {
        ui.notifications.error(`Could not render Token Layer image: ${error?.message ?? error}`);
      }
      return false;
    }
  }

  scheduleTokenSort() {
    if (this.sortScheduled) return;
    this.sortScheduled = true;

    queueMicrotask(() => {
      this.sortScheduled = false;
      this.ensureTokenArtworkAboveImage();
    });
  }

  ensureTokenArtworkAboveImage() {
    const primary = canvas?.primary;
    if (!primary || this.root?.parent !== primary) return false;

    primary.sortChildren?.();
    primary.renderDirty = true;

    const tokenMeshes = primary.tokens?.values
      ? Array.from(primary.tokens.values()).filter((mesh) => mesh?.parent === primary)
      : [];
    const imageIndex = primary.getChildIndex(this.root);
    const firstTokenIndex = tokenMeshes.length
      ? Math.min(...tokenMeshes.map((mesh) => primary.getChildIndex(mesh)))
      : -1;

    return firstTokenIndex < 0 || imageIndex < firstTokenIndex;
  }

  destroy() {
    this.drawGeneration += 1;
    unpinTexture(this.texturePath);
    const primary = canvas?.primary;
    const wasInPrimary = this.root?.parent === primary;
    destroyDisplayObject(this.root);
    if (wasInPrimary && primary) primary.renderDirty = true;
    this.root = null;
    this.sceneId = null;
    this.texturePath = "";
  }
}

const tokenLayerRenderer = new SceneGalleryTokenLayerRenderer();

export function getTokenLayerImage(scene = getActiveScene()) {
  return scene?.getFlag?.(MODULE_ID, FLAG_KEY) ?? null;
}

async function performDisplayImageOnTokenLayer(path, title = "") {
  const scene = getActiveScene();
  if (!scene) {
    ui.notifications.warn("Open a scene before displaying an image on its Token Layer.");
    return false;
  }

  if (!(scene.isOwner ?? game.user?.isGM)) {
    ui.notifications.error(`You cannot edit ${scene.name || "the active scene"}.`);
    return false;
  }

  const image = {
    path,
    name: String(title || "").trim() || getImageLabel(path),
    opacity: 1
  };
  const previousImage = getTokenLayerImage(scene);
  let flagUpdated = false;

  try {
    await withLocalSceneUpdate(
      scene,
      () => scene.setFlag(MODULE_ID, FLAG_KEY, image)
    );
    flagUpdated = true;
    await tokenLayerRenderer.draw(scene, { throwOnError: true });
    return true;
  } catch (error) {
    if (flagUpdated) {
      try {
        await withLocalSceneUpdate(
          scene,
          () => previousImage?.path
            ? scene.setFlag(MODULE_ID, FLAG_KEY, previousImage)
            : scene.unsetFlag(MODULE_ID, FLAG_KEY)
        );
        await tokenLayerRenderer.draw(scene, { notifyOnError: false });
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | Could not restore the previous Token Layer image`, rollbackError);
      }
    }

    console.error(`${MODULE_ID} | Could not display image on the Token Layer`, error);
    ui.notifications.error(`Could not display image on the Token Layer: ${error?.message ?? error}`);
    return false;
  }
}

export function displayImageOnTokenLayer(path, title = "") {
  return enqueueTokenLayerMutation(() => performDisplayImageOnTokenLayer(path, title));
}

async function performRemoveImageFromTokenLayer() {
  const scene = getActiveScene();
  if (!scene) {
    ui.notifications.warn("Open a scene before removing its Token Layer image.");
    return false;
  }

  if (!(scene.isOwner ?? game.user?.isGM)) {
    ui.notifications.error(`You cannot edit ${scene.name || "the active scene"}.`);
    return false;
  }

  const image = getTokenLayerImage(scene);
  if (!image?.path) {
    ui.notifications.info("The active scene has no Token Layer image.");
    return false;
  }

  try {
    await withLocalSceneUpdate(
      scene,
      () => scene.unsetFlag(MODULE_ID, FLAG_KEY)
    );
    await tokenLayerRenderer.draw(scene);
    ui.notifications.info(`Removed ${image.name || getImageLabel(image.path)} from the Token Layer.`);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not remove image from the Token Layer`, error);
    ui.notifications.error(`Could not remove image from the Token Layer: ${error?.message ?? error}`);
    return false;
  }
}

export function removeImageFromTokenLayer() {
  return enqueueTokenLayerMutation(performRemoveImageFromTokenLayer);
}

export function registerTokenLayerRenderer() {
  Hooks.on("canvasReady", async (activeCanvas) => {
    await tokenLayerRenderer.draw(activeCanvas?.scene ?? canvas?.scene);
  });

  Hooks.on("drawToken", () => {
    tokenLayerRenderer.scheduleTokenSort();
  });

  Hooks.on("canvasTearDown", () => {
    tokenLayerRenderer.destroy();
  });

  Hooks.on("updateScene", async (scene, changes) => {
    if (scene.id !== canvas?.scene?.id) return;

    const changedFlag = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG_KEY}`)
      || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`);
    if (changedFlag && !locallyUpdatedScenes.has(scene.id)) {
      await tokenLayerRenderer.draw(scene);
    }
  });
}
