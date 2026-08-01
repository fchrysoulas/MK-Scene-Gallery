import { registerSettings, migrateLegacySettings } from "./settings.js";
import { registerHbsHelpers } from "./hbsHelpers.js";
import { MediaGalleryApp } from "./app.js";

function addSceneControlButton(controls) {
  const tokenControls = Array.isArray(controls)
    ? controls.find((control) => ["token", "tokens"].includes(control?.name))
    : controls?.tokens
      ?? controls?.token
      ?? Object.values(controls ?? {}).find((control) => ["token", "tokens"].includes(control?.name));
  if (!tokenControls) return;

  const openGallery = () => new MediaGalleryApp().render({ force: true });
  const tool = {
    name: "mk-scene-gallery",
    title: "MK-Scene-Gallery",
    icon: "fas fa-images",
    visible: game.user.isGM,
    button: true
  };

  if (Array.isArray(tokenControls.tools)) {
    tool.onClick = openGallery;
    tokenControls.tools.push(tool);
    return;
  }

  tokenControls.tools ??= {};
  tokenControls.tools["mk-scene-gallery"] = {
    ...tool,
    order: Object.keys(tokenControls.tools).length,
    onChange: openGallery
  };
}

Hooks.once("init", () => {
  registerSettings();
  registerHbsHelpers();
  Hooks.on("getSceneControlButtons", addSceneControlButton);
});

Hooks.once("ready", async () => {
  await migrateLegacySettings();
});
