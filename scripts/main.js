import { registerSettings, migrateLegacySettings } from "./settings.js";
import { registerHbsHelpers } from "./hbsHelpers.js";
import { MediaGalleryApp } from "./app.js";
import { registerBackgroundTransitionHooks } from "./backgroundTransitions.js";

function addSceneControlButton(controls) {
  const tokenControls = controls.tokens;
  if (!tokenControls) return;

  const openGallery = () => new MediaGalleryApp().render({ force: true });
  tokenControls.tools["mk-scene-gallery"] = {
    name: "mk-scene-gallery",
    title: "MK-Scene-Gallery",
    icon: "fas fa-images",
    order: Object.keys(tokenControls.tools).length,
    visible: game.user.isGM,
    button: true,
    onChange: openGallery
  };
}

Hooks.once("init", () => {
  registerSettings();
  registerHbsHelpers();
  Hooks.on("getSceneControlButtons", addSceneControlButton);
});

Hooks.once("ready", async () => {
  registerBackgroundTransitionHooks();
  await migrateLegacySettings();
});
