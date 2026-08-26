# MK-Scene-Gallery

A Foundry VTT v13-v14 module for browsing images and WebM videos from your
User Data folders and setting them as Scene backgrounds.

## Installation

### From Foundry

1. Open Foundry's **Setup** screen and select **Add-on Modules > Install Module**.
2. Paste this manifest URL into **Manifest URL**:

   `https://github.com/fchrysoulas/MK-Scene-Gallery/releases/latest/download/module.json`

3. Click **Install**, launch your World, and enable **MK-Scene-Gallery** in
   **Manage Modules**.

### Manual installation

1. Download `mk-scene-gallery.zip` from the [latest release](https://github.com/fchrysoulas/MK-Scene-Gallery/releases/latest).
2. Extract it into your Foundry User Data directory under
   `Data/modules/mk-scene-gallery`.
3. Restart Foundry, launch your World, and enable the module in **Manage
   Modules**.

## Features

- Browse, search, filter, favorite, and preview images and looping WebM videos
  from a selected folder, including optional subfolders.
- Upload files and edit image names, descriptions, and custom tags.
- Set an image or video as the active Scene background, remove it from the
  gallery toolbar, and fade background changes made by Foundry or other modules.
- Save per-image Scene presets for grid, vision, fog, weather, lighting,
  background, padding, linked Journals, Playlist Sounds, and canvas view.
- Apply presets, open linked Journals, start linked audio, and copy supported
  settings from the active Scene.
- Configure title size and maximum grid size; Ambient Lights preserve their
  rendered coverage when the Scene grid size changes.

## Usage

1. Open a World and click **MK-Scene-Gallery** in the left Scene Controls
   toolbar.
2. Choose a folder, then refresh or rebuild the index if needed.
3. Left-click a thumbnail to open its Scene Details inspector. Right-click it
   for a large image or video preview.
4. Use **Favorites**, **Recently Displayed**, tags, or search to find assets.
5. In the inspector, click **Display** to apply the image and its saved Scene
   preset to the active Scene. Use **Remove scene image** to clear the background.

## Migration from Share Media Gallery

This module replaces the former `share-media-gallery` module ID. On the first
GM login, it attempts to migrate the former world's selected folder,
subfolder setting, and page size. After confirming the migration, remove the
old module folder so both modules are not enabled at the same time.
