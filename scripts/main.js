import { registerSettings, migrateLegacySettings } from "./settings.js";
import { registerHbsHelpers } from "./hbsHelpers.js";
import { MediaGalleryApp } from "./app.js";

function addSceneControlButton(controls) {
  const tokenControls = controls.find((control) => control.name === "token");
  if (!tokenControls) return;

  tokenControls.tools.push({
    name: "mk-scene-gallery",
    title: "MK-Scene-Gallery",
    icon: "fas fa-images",
    visible: game.user.isGM,
    onClick: () => new MediaGalleryApp().render(true),
    button: true
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerHbsHelpers();
  Hooks.on("getSceneControlButtons", addSceneControlButton);
});

Hooks.once("ready", async () => {
  await migrateLegacySettings();
});
