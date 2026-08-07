# MK-Scene-Gallery (Foundry VTT v13–v14)

A lightweight gallery browser for scene images and WebM videos inside your Foundry User Data folders.

## Features
- Pick a gallery folder using Foundry's FilePicker.
- Upload images and WebM videos into the selected folder.
- Refresh and rebuild the gallery index.
- Optionally include subfolders.
- Browse images and looping WebM previews in folder groups.
- Left-click a thumbnail to open its Scene Details inside the gallery window.
- Right-click a thumbnail to open a large image or video preview.
- Edit an image name, description, custom tags, and Scene preset in the gallery's Scene Details inspector.
- Mark images as personal Favorites and filter the full indexed library to them.
- Reopen recently displayed images from a personal Recently Displayed view.
- Filter the indexed library by custom tags such as `town`, `combat`, `night`, or `interior`.
- Save complete per-image Scene presets for grid appearance and scale, darkness,
  token vision, fog exploration, weather, background color, padding, initial view,
  linked Journals, and Playlist Sounds.
- Optionally open a linked Journal or start linked Playlist audio when an image is displayed.
- Copy supported settings from the active Scene into an image preset.
- Clear all saved metadata for an image from the Scene Details inspector.
- Search images by path, name, folder, description, or tag.
- Configure the image-title font size in Module Settings.
- Set an image or looping WebM video as the active Scene's native background.
- Fade whenever the viewed Scene or Level background changes, including changes
  made from Scene Configuration, macros, or other modules.
- Remove the current Scene background from the gallery toolbar.
- Configure the maximum Scene grid slider size in Module Settings (300 px by default).
- Keep Ambient Light centers and rendered pixel coverage fixed while inversely adjusting their configured radii for Scene grid-size changes.

## Requirements
- Foundry VTT v13 or v14

## Usage
1. Open a World.
2. Open the left Scene Controls toolbar.
3. Under the Token controls, click **MK-Scene-Gallery**.
4. Pick a folder if needed.
5. Left-click an image to open Scene Details inside the gallery, then set
   its name, description, tags, and Scene preset. Use **Copy Current** to capture the
   active Scene configuration, linked Journal and Playlist Sound, and current canvas view.
   Right-click an image when you want a large preview.
6. Use the thumbnail star to add an image to **Favorites**, or choose a tag,
   **Favorites**, or **Recently Displayed** under **Quick access** to filter the library.
7. Click **Display** in the inspector or use the thumbnail's image button to
   set it as the active Scene's background. Its saved Scene settings and native
   Journal and Playlist associations are applied first, followed by any enabled
   open-Journal or start-audio actions.
8. Click **Remove scene image** to clear the Scene background.

## Rename and settings migration
This package replaces the former `share-media-gallery` module ID with `mk-scene-gallery`.

On the first GM login after installation, MK-Scene-Gallery attempts to copy the former world settings for:
- selected base folder,
- include-subfolders state,
- page size.

After confirming the new package works, remove the old Share Media Gallery module folder so both packages are not enabled at the same time.
