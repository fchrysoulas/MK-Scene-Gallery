import { scaleAmbientLightRadiiForGrid } from "./lighting.js";

export const KEEP_CURRENT = "__keep__";

const GRID_TYPES = [
  { value: 0, label: "Gridless" },
  { value: 1, label: "Square" },
  { value: 2, label: "Hex Columns, Odd" },
  { value: 3, label: "Hex Columns, Even" },
  { value: 4, label: "Hex Rows, Odd" },
  { value: 5, label: "Hex Rows, Even" }
];

function finiteOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampOrNull(value, min, max) {
  const number = finiteOrNull(value);
  if (number === null) return null;
  return Math.min(max, Math.max(min, number));
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string || null;
}

function booleanOrNull(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function colorOrNull(value) {
  const color = stringOrNull(value);
  if (!color) return null;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

export function normalizeScenePreset(rawPreset = {}, { gridSizeMax = 1000 } = {}) {
  const preset = rawPreset && typeof rawPreset === "object" && !Array.isArray(rawPreset)
    ? rawPreset
    : {};
  const gridType = finiteOrNull(preset.gridType);
  const weather = Object.prototype.hasOwnProperty.call(preset, "weather")
    && preset.weather !== null
      ? String(preset.weather)
      : null;

  return {
    gridSize: (() => {
      const value = clampOrNull(preset.gridSize, 50, gridSizeMax);
      return value === null ? null : Math.round(value / 25) * 25;
    })(),
    gridType: GRID_TYPES.some((option) => option.value === gridType)
      ? gridType
      : null,
    gridColor: colorOrNull(preset.gridColor),
    gridAlpha: clampOrNull(preset.gridAlpha, 0, 1),
    gridDistance: (() => {
      const value = finiteOrNull(preset.gridDistance);
      return value !== null && value > 0 ? value : null;
    })(),
    gridUnits: stringOrNull(preset.gridUnits),
    backgroundColor: colorOrNull(preset.backgroundColor),
    darkness: clampOrNull(preset.darkness, 0, 1),
    tokenVision: booleanOrNull(preset.tokenVision),
    fogExploration: booleanOrNull(preset.fogExploration),
    weather,
    padding: clampOrNull(preset.padding, 0, 0.5),
    initialX: finiteOrNull(preset.initialX),
    initialY: finiteOrNull(preset.initialY),
    initialScale: clampOrNull(preset.initialScale, 0.1, 3)
  };
}

export function hasScenePresetValues(rawPreset) {
  const preset = normalizeScenePreset(rawPreset);
  return Object.values(preset).some((value) => value !== null);
}

function option(value, label, selectedValue) {
  return {
    value,
    label,
    selected: String(value) === String(selectedValue)
  };
}

export function prepareScenePresetForm(rawPreset, { gridSizeMax = 1000 } = {}) {
  const preset = normalizeScenePreset(rawPreset, { gridSizeMax });
  const weatherSelection = preset.weather === null ? KEEP_CURRENT : preset.weather;
  const weatherEffects = globalThis.CONFIG?.weatherEffects ?? {};
  const weatherEntries = Object.entries(weatherEffects)
    .map(([key, config]) => {
      const value = config?.id ?? key;
      const rawLabel = config?.label ?? config?.name ?? value;
      const label = globalThis.game?.i18n?.localize?.(rawLabel) ?? rawLabel;
      return { value, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  return {
    ...preset,
    gridTypeOptions: [
      option("", "Keep current", preset.gridType === null ? "" : preset.gridType),
      ...GRID_TYPES.map((entry) => option(entry.value, entry.label, preset.gridType))
    ],
    tokenVisionOptions: [
      option("", "Keep current", preset.tokenVision === null ? "" : preset.tokenVision),
      option("true", "Enabled", preset.tokenVision),
      option("false", "Disabled", preset.tokenVision)
    ],
    fogExplorationOptions: [
      option("", "Keep current", preset.fogExploration === null ? "" : preset.fogExploration),
      option("true", "Enabled", preset.fogExploration),
      option("false", "Disabled", preset.fogExploration)
    ],
    weatherOptions: [
      option(KEEP_CURRENT, "Keep current", weatherSelection),
      option("", "None", weatherSelection),
      ...weatherEntries.map((entry) => option(entry.value, entry.label, weatherSelection))
    ]
  };
}

export function readScenePresetForm(form, { gridSizeMax = 1000 } = {}) {
  const value = (name) => form?.elements?.[name]?.value ?? "";
  const weatherValue = value("weather");

  return normalizeScenePreset({
    gridSize: value("gridSize"),
    gridType: value("gridType"),
    gridColor: value("gridColor"),
    gridAlpha: value("gridAlpha"),
    gridDistance: value("gridDistance"),
    gridUnits: value("gridUnits"),
    backgroundColor: value("backgroundColor"),
    darkness: value("darkness"),
    tokenVision: value("tokenVision"),
    fogExploration: value("fogExploration"),
    weather: weatherValue === KEEP_CURRENT ? null : weatherValue,
    padding: value("padding"),
    initialX: value("initialX"),
    initialY: value("initialY"),
    initialScale: value("initialScale")
  }, { gridSizeMax });
}

export function captureScenePreset(scene, { gridSizeMax = 1000 } = {}) {
  const isV13 = Number(game.release?.generation) >= 13;
  const initial = scene?.initial ?? {};
  const activeCanvas = globalThis.canvas;
  const currentView = activeCanvas?.scene?.id === scene?.id
    ? {
        x: finiteOrNull(activeCanvas?.stage?.pivot?.x),
        y: finiteOrNull(activeCanvas?.stage?.pivot?.y),
        scale: finiteOrNull(activeCanvas?.stage?.scale?.x)
      }
    : {};

  return normalizeScenePreset({
    gridSize: scene?.grid?.size,
    gridType: scene?.grid?.type,
    gridColor: scene?.grid?.color,
    gridAlpha: scene?.grid?.alpha,
    gridDistance: scene?.grid?.distance,
    gridUnits: scene?.grid?.units,
    backgroundColor: scene?.backgroundColor,
    darkness: isV13
      ? scene?.environment?.darknessLevel
      : scene?.darkness,
    tokenVision: scene?.tokenVision,
    fogExploration: isV13
      ? scene?.fog?.exploration
      : scene?.fogExploration,
    weather: scene?.weather ?? "",
    padding: scene?.padding,
    initialX: currentView.x ?? initial.x,
    initialY: currentView.y ?? initial.y,
    initialScale: currentView.scale ?? initial.scale
  }, { gridSizeMax });
}

export async function applyScenePreset(scene, rawPreset, { gridSizeMax = 1000 } = {}) {
  const preset = normalizeScenePreset(rawPreset, { gridSizeMax });
  const update = {};
  const assign = (path, value) => {
    if (value !== null) update[path] = value;
  };

  assign("grid.size", preset.gridSize);
  assign("grid.type", preset.gridType);
  assign("grid.color", preset.gridColor);
  assign("grid.alpha", preset.gridAlpha);
  assign("grid.distance", preset.gridDistance);
  assign("grid.units", preset.gridUnits);
  assign("backgroundColor", preset.backgroundColor);
  assign("tokenVision", preset.tokenVision);
  assign("weather", preset.weather);
  assign("padding", preset.padding);
  assign("initial.x", preset.initialX);
  assign("initial.y", preset.initialY);
  assign("initial.scale", preset.initialScale);

  const isV13 = Number(game.release?.generation) >= 13;
  assign(isV13 ? "environment.darknessLevel" : "darkness", preset.darkness);
  assign(isV13 ? "fog.exploration" : "fogExploration", preset.fogExploration);

  if (Object.keys(update).length === 0) {
    return { changed: false, gridChanged: false, preset };
  }

  const previousGridSize = Number(scene?.grid?.size);
  const gridChanged = preset.gridSize !== null
    && Number.isFinite(previousGridSize)
    && previousGridSize > 0
    && preset.gridSize !== previousGridSize;

  await scene.update(update);
  if (gridChanged) {
    await scaleAmbientLightRadiiForGrid(scene, previousGridSize, preset.gridSize);
  }

  return { changed: true, gridChanged, preset };
}
