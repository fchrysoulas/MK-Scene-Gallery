import { MODULE_ID } from "./settings.js";
import { withBackgroundTransition } from "./backgroundTransitions.js";

let backgroundMutationQueue = Promise.resolve();

function enqueueBackgroundMutation(operation) {
  const result = backgroundMutationQueue.then(operation, operation);
  backgroundMutationQueue = result.catch(() => {});
  return result;
}

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

export function getSceneBackground(scene) {
  const path = scene?.background?.src;
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

  try {
    await withBackgroundTransition(
      scene,
      backgroundPath,
      () => scene.update({ "background.src": backgroundPath })
    );
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not set the Scene background`, error);
    ui.notifications.error(`Could not set the Scene background: ${error?.message ?? error}`);
    return false;
  }
}

export function setSceneBackground(scene, path) {
  return enqueueBackgroundMutation(() => performSetSceneBackground(scene, path));
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

  try {
    await withBackgroundTransition(
      scene,
      null,
      () => scene.update({ "background.src": null })
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
  return enqueueBackgroundMutation(() => performRemoveSceneBackground(scene));
}
