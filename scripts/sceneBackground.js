import { MODULE_ID } from "./settings.js";
import { updateBackgroundDocumentWithTransition } from "./backgroundTransitions.js";

function getImageLabel(path) {
  const fileName = String(path || "").split("/").pop() || "Scene background";

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function canEditScene(scene) {
  return scene?.isOwner ?? !!game.user?.isGM;
}

function getBackgroundDocument(scene) {
  if (Number(game.release?.generation) < 14) return scene;

  const activeCanvas = globalThis.canvas;
  if (activeCanvas?.scene?.id === scene?.id && activeCanvas.level) {
    return activeCanvas.level;
  }
  return scene?.initialLevel ?? scene?.firstLevel ?? null;
}

export function getSceneBackground(scene) {
  const path = getBackgroundDocument(scene)?.background?.src;
  return path
    ? {
        path,
        name: getImageLabel(path)
      }
    : null;
}

async function performSetSceneBackground(scene, path) {
  if (!scene) {
    ui.notifications.warn("Open a scene before setting its background.");
    return false;
  }

  if (!canEditScene(scene)) {
    ui.notifications.error(`You cannot edit ${scene.name || "the selected Scene"}.`);
    return false;
  }

  const backgroundPath = String(path || "").trim();
  if (!backgroundPath) {
    ui.notifications.warn("No image path found.");
    return false;
  }

  const backgroundDocument = getBackgroundDocument(scene);
  if (!backgroundDocument) {
    ui.notifications.error("The selected Scene has no background Level.");
    return false;
  }

  try {
    await updateBackgroundDocumentWithTransition(
      backgroundDocument,
      { "background.src": backgroundPath }
    );
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not set the Scene background`, error);
    ui.notifications.error(`Could not set the Scene background: ${error?.message ?? error}`);
    return false;
  }
}

export function setSceneBackground(scene, path) {
  return performSetSceneBackground(scene, path);
}

async function performRemoveSceneBackground(scene) {
  if (!scene) {
    ui.notifications.warn("Open a scene before removing its background.");
    return false;
  }

  if (!canEditScene(scene)) {
    ui.notifications.error(`You cannot edit ${scene.name || "the selected Scene"}.`);
    return false;
  }

  const background = getSceneBackground(scene);
  if (!background) {
    ui.notifications.info("The selected Scene has no background image.");
    return false;
  }

  const backgroundDocument = getBackgroundDocument(scene);
  if (!backgroundDocument) {
    ui.notifications.error("The selected Scene has no background Level.");
    return false;
  }

  try {
    await updateBackgroundDocumentWithTransition(
      backgroundDocument,
      { "background.src": Number(game.release?.generation) >= 14 ? "" : null }
    );
    ui.notifications.info(`Removed ${background.name} from the Scene background.`);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not remove the Scene background`, error);
    ui.notifications.error(`Could not remove the Scene background: ${error?.message ?? error}`);
    return false;
  }
}

export function removeSceneBackground(scene) {
  return performRemoveSceneBackground(scene);
}
