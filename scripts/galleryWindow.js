import { MODULE_ID } from "./settings.js";

const WINDOW_POSITION_KEYS = ["left", "top", "width", "height"];

export function normalizeWindowPosition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return WINDOW_POSITION_KEYS.reduce((position, key) => {
    const number = Number(value[key]);
    const valid = key === "width" || key === "height"
      ? Number.isFinite(number) && number > 0
      : Number.isFinite(number);
    if (valid) position[key] = Math.round(number);
    return position;
  }, {});
}

export function getSavedWindowPosition() {
  const saved = globalThis.game?.settings?.get?.(MODULE_ID, "windowPosition");
  return normalizeWindowPosition(saved);
}

export function getGalleryWindowTitle() {
  const version = globalThis.game?.modules?.get?.(MODULE_ID)?.version;
  return version ? `MK-Scene-Gallery v${version}` : "MK-Scene-Gallery";
}
