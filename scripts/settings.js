export const MODULE_ID = "mk-scene-gallery";
export const LEGACY_MODULE_ID = "share-media-gallery";
export const DEFAULT_GRID_SIZE_MAX = 300;
export const DEFAULT_IMAGE_TITLE_FONT_SIZE = 10;
export const DEFAULT_TOKEN_LAYER_TRANSITION_MS = 500;

const DEFAULTS = {
  baseDir: "uploads/",
  recursive: true,
  pageSize: 120,
  pinnedFolders: [],
  imageTitles: {},
  imageMetadata: {},
  imageTitleFontSize: DEFAULT_IMAGE_TITLE_FONT_SIZE,
  tokenLayerTransitionMs: DEFAULT_TOKEN_LAYER_TRANSITION_MS,
  gridSizeMax: DEFAULT_GRID_SIZE_MAX
};

export function registerSettings() {
  game.settings.register(MODULE_ID, "baseDir", {
    name: "Base directory",
    hint: "Folder to scan for images (relative to your data source).",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULTS.baseDir
  });

  game.settings.register(MODULE_ID, "recursive", {
    name: "Include subfolders",
    hint: "Walk subfolders by making multiple FilePicker.browse calls (cached).",
    scope: "world",
    config: false,
    type: Boolean,
    default: DEFAULTS.recursive
  });

  game.settings.register(MODULE_ID, "pageSize", {
    name: "Page size",
    hint: "How many thumbnails to render per page.",
    scope: "world",
    config: false,
    type: Number,
    default: DEFAULTS.pageSize
  });

  game.settings.register(MODULE_ID, "pinnedFolders", {
    name: "Pinned gallery folders",
    hint: "Folders pinned to the top of the MK-Scene-Gallery folder tree.",
    scope: "client",
    config: false,
    type: Array,
    default: DEFAULTS.pinnedFolders
  });

  game.settings.register(MODULE_ID, "imageTitles", {
    name: "Image titles",
    hint: "Custom gallery titles keyed by image path.",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULTS.imageTitles
  });

  game.settings.register(MODULE_ID, "imageMetadata", {
    name: "Image metadata",
    hint: "Names, descriptions, and preferred Scene grid sizes keyed by image path.",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULTS.imageMetadata
  });

  game.settings.register(MODULE_ID, "imageTitleFontSize", {
    name: "Image title font size",
    hint: "Font size, in pixels, used for image titles in the gallery.",
    scope: "client",
    config: true,
    type: Number,
    default: DEFAULTS.imageTitleFontSize,
    range: {
      min: 8,
      max: 24,
      step: 1
    }
  });

  game.settings.register(MODULE_ID, "tokenLayerTransitionMs", {
    name: "Token Layer crossfade duration",
    hint: "Crossfade duration in milliseconds when changing images. Set to 0 to disable.",
    scope: "client",
    config: true,
    type: Number,
    default: DEFAULTS.tokenLayerTransitionMs,
    range: {
      min: 0,
      max: 3000,
      step: 100
    }
  });

  game.settings.register(MODULE_ID, "gridSizeMax", {
    name: "Maximum grid slider size",
    hint: "The maximum Scene grid size, in pixels, available in the gallery slider.",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.gridSizeMax,
    range: {
      min: 50,
      max: 1000,
      step: 25
    }
  });

  game.settings.register(MODULE_ID, "legacyMigrationComplete", {
    name: "Legacy migration complete",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}

function getLegacyWorldValue(key) {
  const storage = game.settings.storage.get("world");
  const setting = storage?.get(`${LEGACY_MODULE_ID}.${key}`);
  return setting?.value;
}

function normalizeLegacyValue(key, value) {
  if (value === undefined || value === null) return undefined;

  switch (key) {
    case "baseDir":
      return String(value).trim();
    case "recursive":
      return value === true || value === "true";
    case "pageSize": {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : undefined;
    }
    default:
      return value;
  }
}

export async function migrateLegacySettings() {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, "legacyMigrationComplete")) return;

  const keys = ["baseDir", "recursive", "pageSize"];
  let migrated = false;

  for (const key of keys) {
    const legacyValue = normalizeLegacyValue(key, getLegacyWorldValue(key));
    if (legacyValue === undefined || legacyValue === "") continue;

    await game.settings.set(MODULE_ID, key, legacyValue);
    migrated = true;
  }

  await game.settings.set(MODULE_ID, "legacyMigrationComplete", true);

  if (migrated) {
    console.info(`${MODULE_ID} | Migrated world settings from ${LEGACY_MODULE_ID}.`);
  }
}
