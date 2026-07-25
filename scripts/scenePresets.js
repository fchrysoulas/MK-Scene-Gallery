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

function floorOrNull(value) {
  const number = finiteOrNull(value);
  return number === null ? null : Math.floor(number);
}

function roundOrNull(value, decimalPlaces) {
  const number = finiteOrNull(value);
  if (number === null) return null;
  const factor = 10 ** decimalPlaces;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string || null;
}

function associationOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const id = value.id ?? value._id;
    return id ? String(id) : null;
  }
  return String(value).trim();
}

function booleanOrNull(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function enabledOrNull(value) {
  return value === true || value === "true" ? true : null;
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
    journal: associationOrNull(preset.journal),
    playlist: associationOrNull(preset.playlist),
    playlistSound: associationOrNull(preset.playlistSound),
    openJournal: enabledOrNull(preset.openJournal),
    startPlaylistSound: enabledOrNull(preset.startPlaylistSound),
    initialX: floorOrNull(preset.initialX),
    initialY: floorOrNull(preset.initialY),
    initialScale: roundOrNull(clampOrNull(preset.initialScale, 0.1, 3), 2)
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

function collectionContents(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  return collection ? Array.from(collection) : [];
}

function playlistSoundLink(playlistId, soundId) {
  if (playlistId === null && soundId === null) return KEEP_CURRENT;
  if (!playlistId) return "";
  return `${playlistId}:${soundId || ""}`;
}

export function prepareScenePresetForm(rawPreset, { gridSizeMax = 1000 } = {}) {
  const preset = normalizeScenePreset(rawPreset, { gridSizeMax });
  const weatherSelection = preset.weather === null ? KEEP_CURRENT : preset.weather;
  const journalSelection = preset.journal === null ? KEEP_CURRENT : preset.journal;
  const selectedPlaylistSoundLink = playlistSoundLink(preset.playlist, preset.playlistSound);
  const weatherEffects = globalThis.CONFIG?.weatherEffects ?? {};
  const weatherEntries = Object.entries(weatherEffects)
    .map(([key, config]) => {
      const value = config?.id ?? key;
      const rawLabel = config?.label ?? config?.name ?? value;
      const label = globalThis.game?.i18n?.localize?.(rawLabel) ?? rawLabel;
      return { value, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  const journals = collectionContents(globalThis.game?.journal)
    .filter((journal) => journal?.id)
    .sort((a, b) => String(a.name || "").localeCompare(
      String(b.name || ""),
      undefined,
      { sensitivity: "base" }
    ));
  const journalOptions = [
    option(KEEP_CURRENT, "Keep current", journalSelection),
    option("", "None", journalSelection),
    ...journals.map((journal) => option(journal.id, journal.name, journalSelection))
  ];
  if (
    journalSelection
    && journalSelection !== KEEP_CURRENT
    && !journals.some((journal) => journal.id === journalSelection)
  ) {
    journalOptions.push(option(
      journalSelection,
      `Missing Journal (${journalSelection})`,
      journalSelection
    ));
  }

  const playlists = collectionContents(globalThis.game?.playlists)
    .filter((playlist) => playlist?.id)
    .sort((a, b) => String(a.name || "").localeCompare(
      String(b.name || ""),
      undefined,
      { sensitivity: "base" }
    ));
  const playlistSoundOptions = [
    option(KEEP_CURRENT, "Keep current", selectedPlaylistSoundLink),
    option("", "None", selectedPlaylistSoundLink)
  ];
  for (const playlist of playlists) {
    playlistSoundOptions.push(option(
      playlistSoundLink(playlist.id, ""),
      `${playlist.name} — Entire playlist`,
      selectedPlaylistSoundLink
    ));

    const sounds = collectionContents(playlist.sounds)
      .filter((sound) => sound?.id)
      .sort((a, b) => String(a.name || "").localeCompare(
        String(b.name || ""),
        undefined,
        { sensitivity: "base" }
      ));
    for (const sound of sounds) {
      playlistSoundOptions.push(option(
        playlistSoundLink(playlist.id, sound.id),
        `${playlist.name} — ${sound.name}`,
        selectedPlaylistSoundLink
      ));
    }
  }
  if (
    selectedPlaylistSoundLink
    && selectedPlaylistSoundLink !== KEEP_CURRENT
    && !playlistSoundOptions.some((entry) => entry.value === selectedPlaylistSoundLink)
  ) {
    playlistSoundOptions.push(option(
      selectedPlaylistSoundLink,
      `Missing Playlist Sound (${selectedPlaylistSoundLink})`,
      selectedPlaylistSoundLink
    ));
  }

  return {
    ...preset,
    backgroundColorValue: preset.backgroundColor ?? "#000000",
    backgroundColorEnabled: preset.backgroundColor !== null,
    initialScale: preset.initialScale === null ? null : preset.initialScale.toFixed(2),
    journalOptions,
    journalActionDisabled: !preset.journal,
    playlistSoundLink: selectedPlaylistSoundLink,
    playlistSoundOptions,
    playlistActionDisabled: !preset.playlist,
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
  const checked = (name) => form?.elements?.[name]?.checked === true;
  const weatherValue = value("weather");
  const journalValue = value("journal");
  const linkedSoundValue = value("playlistSoundLink");
  let playlist = null;
  let playlistSound = null;
  if (linkedSoundValue !== KEEP_CURRENT) {
    if (!linkedSoundValue) {
      playlist = "";
      playlistSound = "";
    } else {
      const separator = linkedSoundValue.indexOf(":");
      playlist = separator >= 0 ? linkedSoundValue.slice(0, separator) : linkedSoundValue;
      playlistSound = separator >= 0 ? linkedSoundValue.slice(separator + 1) : "";
    }
  }

  return normalizeScenePreset({
    gridSize: value("gridSize"),
    gridType: value("gridType"),
    gridColor: value("gridColor"),
    gridAlpha: value("gridAlpha"),
    gridDistance: value("gridDistance"),
    gridUnits: value("gridUnits"),
    backgroundColor: checked("useBackgroundColor") ? value("backgroundColor") : "",
    darkness: value("darkness"),
    tokenVision: value("tokenVision"),
    fogExploration: value("fogExploration"),
    weather: weatherValue === KEEP_CURRENT ? null : weatherValue,
    padding: value("padding"),
    journal: journalValue === KEEP_CURRENT ? null : journalValue,
    playlist,
    playlistSound,
    openJournal: checked("openJournal") && journalValue && journalValue !== KEEP_CURRENT,
    startPlaylistSound: checked("startPlaylistSound")
      && linkedSoundValue
      && linkedSoundValue !== KEEP_CURRENT,
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
    journal: scene?.journal ?? "",
    playlist: scene?.playlist ?? "",
    playlistSound: scene?.playlistSound ?? "",
    openJournal: null,
    startPlaylistSound: null,
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
  if (preset.journal !== null) update.journal = preset.journal || null;
  if (preset.playlist !== null) update.playlist = preset.playlist || null;
  if (preset.playlistSound !== null) update.playlistSound = preset.playlistSound || null;

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
