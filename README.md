# MK-Scene-Gallery (Foundry VTT v12)

A lightweight gallery browser for scene and image files inside your Foundry User Data folders.

## Features
- Pick a gallery folder using Foundry's FilePicker.
- Upload images into the selected folder.
- Refresh and rebuild the gallery index.
- Optionally include subfolders.
- Browse images in folder groups.
- Hover an image to open it through Share Media.

## Requirements
- Foundry VTT v12
- Share Media module enabled

## Usage
1. Open a World.
2. Open the left Scene Controls toolbar.
3. Under the Token controls, click **MK-Scene-Gallery**.
4. Pick a folder if needed.
5. Hover an image and click its Share button.

## Rename and settings migration
This package replaces the former `share-media-gallery` module ID with `mk-scene-gallery`.

On the first GM login after installation, MK-Scene-Gallery attempts to copy the former world settings for:
- selected base folder,
- include-subfolders state,
- page size.

After confirming the new package works, remove the old Share Media Gallery module folder so both packages are not enabled at the same time.
