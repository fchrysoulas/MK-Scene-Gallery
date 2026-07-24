# MK-Scene-Gallery (Foundry VTT v12–v13)

A lightweight gallery browser for scene and image files inside your Foundry User Data folders.

## Features
- Pick a gallery folder using Foundry's FilePicker.
- Upload images into the selected folder.
- Refresh and rebuild the gallery index.
- Optionally include subfolders.
- Browse images in folder groups.
- Right-click a thumbnail to open a large image preview.
- Display an image on the active scene's Token Layer.
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
5. Hover an image and click its Layer button to display it on the active
   scene's Token Layer.
6. Click **Remove scene image** to clear it from the scene.

## Rename and settings migration
This package replaces the former `share-media-gallery` module ID with `mk-scene-gallery`.

On the first GM login after installation, MK-Scene-Gallery attempts to copy the former world settings for:
- selected base folder,
- include-subfolders state,
- page size.

After confirming the new package works, remove the old Share Media Gallery module folder so both packages are not enabled at the same time.
