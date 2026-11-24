import { getSceneBackgroundDocument } from "./sceneBackground.js";
import { updateBackgroundDocumentWithTransition } from "./backgroundTransitions.js";
import { applyScenePreset, captureScenePreset, normalizeScenePreset } from "./scenePresets.js";

export function normalizeSceneMapState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !value.background || typeof value.background !== "object" || Array.isArray(value.background)) return null;
  const dimension = (number) => Number.isFinite(Number(number)) && Number(number) > 0
    ? Math.round(Number(number)) : null;
  return {
    background: JSON.parse(JSON.stringify(value.background)),
    width: dimension(value.width),
    height: dimension(value.height),
    preset: normalizeScenePreset(value.preset, {
      gridSizeMax: Math.max(1000, Number(value.preset?.gridSize) || 0), gridSizeStep: 1
    })
  };
}

export function captureSceneMapState(scene) {
  const document = getSceneBackgroundDocument(scene);
  if (!document) throw new Error("The selected Scene has no background Level.");
  return normalizeSceneMapState({
    background: document.toObject().background,
    width: scene.width,
    height: scene.height,
    preset: captureScenePreset(scene, {
      gridSizeMax: Math.max(1000, Number(scene.grid?.size) || 0), gridSizeStep: 1
    })
  });
}

export async function applySceneMapState(scene, value) {
  const state = normalizeSceneMapState(value);
  if (!state) throw new Error("This place has no saved Scene state.");
  const document = getSceneBackgroundDocument(scene);
  if (!document) throw new Error("The selected Scene has no background Level.");
  const dimensions = {};
  if (state.width !== null) dimensions.width = state.width;
  if (state.height !== null) dimensions.height = state.height;
  if (Object.keys(dimensions).length) await scene.update(dimensions, { autoReposition: false });
  await applyScenePreset(scene, state.preset, {
    gridSizeMax: Math.max(1000, state.preset.gridSize || 0), gridSizeStep: 1,
    updateOptions: { autoReposition: false }
  });
  const update = Object.fromEntries(Object.entries(state.background).map(([key, entry]) => [`background.${key}`, entry]));
  if (Object.keys(update).length) {
    await updateBackgroundDocumentWithTransition(document, update, { autoReposition: false });
  }
}

export async function restoreSceneMapView(scene, state) {
  const activeCanvas = globalThis.canvas;
  if (!activeCanvas?.ready || activeCanvas.scene?.id !== scene.id) return;
  const view = {};
  for (const [key, field] of [["x", "initialX"], ["y", "initialY"], ["scale", "initialScale"]]) {
    if (state.preset[field] !== null) view[key] = state.preset[field];
  }
  if (Object.keys(view).length) await activeCanvas.animatePan(view);
}
