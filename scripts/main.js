import { MODULE_ID, migrateLegacySettings, registerSettings } from "./settings.js";
import { registerHbsHelpers } from "./hbsHelpers.js";
import { MediaGalleryApp } from "./app.js";
import { registerBackgroundTransitionHooks } from "./backgroundTransitions.js";

const HUB_METADATA_FLAG = "mk-module-hub";

function openGallery() {
  if (!game.user?.isGM) {
    ui.notifications?.warn?.("Only Game Masters can open MK-Scene-Gallery.");
    return null;
  }

  return new MediaGalleryApp().render({ force: true });
}

const API = Object.freeze({
  open: openGallery
});

function registerModuleHubIntegration(hub) {
  if (!hub || typeof hub.register !== "function") return;

  try {
    const metadata = game.modules.get(MODULE_ID)?.flags?.[HUB_METADATA_FLAG];
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      console.warn(`${MODULE_ID} | Could not register with MK Module Hub: metadata is missing.`);
      return;
    }

    hub.register(MODULE_ID, {
      ...metadata,
      open: API.open
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not register with MK Module Hub`, error);
  }
}

Hooks.once("mkModuleHubReady", registerModuleHubIntegration);

function addSceneControlButton(controls) {
  const tokenControls = controls.tokens;
  if (!tokenControls) return;

  tokenControls.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "MK-Scene-Gallery",
    icon: "fas fa-images",
    order: Object.keys(tokenControls.tools).length,
    visible: game.user.isGM,
    button: true,
    onChange: openGallery
  };
}

Hooks.once("init", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = API;

  registerSettings();
  registerHbsHelpers();
  Hooks.on("getSceneControlButtons", addSceneControlButton);
});

Hooks.once("ready", async () => {
  registerBackgroundTransitionHooks();
  await migrateLegacySettings();
});
