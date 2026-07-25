# MK-Scene-Gallery (Foundry VTT v12–v13)

A lightweight gallery browser for scene images and WebM videos inside your Foundry User Data folders.

## Features
- Pick a gallery folder using Foundry's FilePicker.
- Upload images and WebM videos into the selected folder.
- Refresh and rebuild the gallery index.
- Optionally include subfolders.
- Browse images and looping WebM previews in folder groups.
- Right-click a thumbnail to open its Scene Details in a standalone window.
- Edit an image name, description, custom tags, and Scene preset in its standalone Scene Details window.
- Mark images as personal Favorites and filter the full indexed library to them.
- Reopen recently displayed images from a personal Recently Displayed view.
- Filter the indexed library by custom tags such as `town`, `combat`, `night`, or `interior`.
- Save complete per-image Scene presets for grid appearance and scale, darkness,
  token vision, fog exploration, weather, background color, padding, initial view,
  linked Journals, and Playlist Sounds.
- Optionally open a linked Journal or start linked Playlist audio when an image is displayed.
- Copy supported settings from the active Scene into an image preset.
- Clear all saved metadata for an image from either Scene Details interface.
- Search images by path, name, folder, description, or tag.
- Configure the image-title font size in Module Settings.
- Display an image or looping WebM video on the active scene's Token Layer.
- Crossfade between Token Layer images with a configurable transition duration.
- Remove the current Token Layer image from the gallery toolbar.
- Configure the maximum Scene grid slider size in Module Settings (300 px by default).
- Keep Ambient Light centers and rendered pixel coverage fixed while inversely adjusting their configured radii for Scene grid-size changes.

## Requirements
- Foundry VTT v12 or v13

## Usage
1. Open a World.
2. Open the left Scene Controls toolbar.
3. Under the Token controls, click **MK-Scene-Gallery**.
4. Pick a folder if needed.
5. Right-click an image to open its standalone Scene Details window, then set
   its name, description, tags, and Scene preset. Use **Copy Current** to capture the
   active Scene configuration, linked Journal and Playlist Sound, and current canvas view.
6. Use the thumbnail star to add an image to **Favorites**, or choose a tag,
   **Favorites**, or **Recently Displayed** under **Quick access** to filter the library.
7. Click **Display** in the inspector or use the thumbnail's Layer button to
   display it on the active scene's Token Layer. Its saved Scene settings and native
   Journal and Playlist associations are applied first, followed by any enabled
   open-Journal or start-audio actions.
8. Click **Remove scene image** to clear it from the scene.

## Rename and settings migration
This package replaces the former `share-media-gallery` module ID with `mk-scene-gallery`.

On the first GM login after installation, MK-Scene-Gallery attempts to copy the former world settings for:
- selected base folder,
- include-subfolders state,
- page size.

After confirming the new package works, remove the old Share Media Gallery module folder so both packages are not enabled at the same time.
