import { DEFAULT_GRID_SIZE_MAX, MODULE_ID } from "./settings.js";
import { applyScenePreset, normalizeScenePreset } from "./scenePresets.js";

export function getSelectedScene() {
  return game.scenes?.viewed
    ?? game.scenes?.current
    ?? game.canvas?.scene
    ?? globalThis.canvas?.scene
    ?? game.scenes?.active
    ?? null;
}

export function getGridSizeMax() {
  const configured = Number(game.settings.get(MODULE_ID, "gridSizeMax"));
  if (!Number.isFinite(configured) || configured < 50) return DEFAULT_GRID_SIZE_MAX;
  return Math.max(50, Math.round(configured / 25) * 25);
}

export function getSceneGridSliderData(scene = getSelectedScene()) {
  const size = Number(scene?.grid?.size ?? scene?.dimensions?.size) || 100;
  const max = getGridSizeMax();
  const disabled = !scene || !(scene.isOwner ?? !!game.user?.isGM);
  return {
    min: 50,
    max,
    step: 25,
    value: Math.min(max, Math.max(50, size)),
    label: scene ? size.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—",
    disabled,
    title: !scene ? "Open a Scene to change its battle grid size"
      : disabled ? `You cannot edit ${scene.name || "the selected Scene"}`
        : `Change ${scene.name || "selected Scene"} battle grid size`
  };
}

export async function applySceneGridSize(scene, requested, { notifyOnSuccess = false } = {}) {
  const requestedNumber = Number(requested);
  if (!scene || !Number.isFinite(requestedNumber)) return false;
  if (!(scene.isOwner ?? !!game.user?.isGM)) {
    ui.notifications.error(`You cannot edit ${scene.name || "the selected Scene"}.`);
    return false;
  }

  const gridSizeMax = getGridSizeMax();
  const normalized = normalizeScenePreset({ gridSize: requestedNumber }, { gridSizeMax });
  if (normalized.gridSize === Number(scene.grid?.size ?? scene.dimensions?.size)) return true;
  try {
    const result = await applyScenePreset(scene, normalized, { gridSizeMax });
    if (notifyOnSuccess) {
      ui.notifications.info(
        `Grid size changed to ${result.preset.gridSize} px. Ambient Light positions and pixel coverage were preserved.`
      );
    }
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not update Scene grid size`, error);
    ui.notifications.error("Could not update the Scene grid size and Ambient Light radii.");
    return false;
  }
}
