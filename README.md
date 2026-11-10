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

- Browse, search, filter, favorite, and preview images—including WebP—and
  looping WebM videos from a selected folder, including optional subfolders.
- Upload files and edit image names, descriptions, and custom tags.
- Create world-wide virtual folders and move images into them individually,
  in batches, or by dragging thumbnails onto a folder. Files stay in place.
- Set an image or video as the active Scene background, remove it from the
  gallery toolbar, and fade background changes made by Foundry or other modules.
- Save per-image Scene presets for grid, vision, fog, weather, lighting,
  background, padding, linked Journals, Playlist Sounds, and canvas view.
- Use Scene Details tabs for image info and preset sections, and drag Journal
  Entries, Playlists, or Playlist Sounds onto their linked-content fields; saved
  links run automatically when the image is displayed.
- Apply presets, open linked Journals, start linked audio, and copy supported
  settings from the active Scene.
- Configure title size and maximum grid size; Ambient Lights preserve their
  rendered coverage when the Scene grid size changes.

When [MK Module Hub](https://github.com/fchrysoulas/MK-Module-Hub) is installed,
MK-Scene-Gallery is available in the Hub catalog and its module details can open
the gallery directly.

## Usage

1. Open a World and click **MK-Scene-Gallery** in the left Scene Controls
   toolbar.
2. Choose a folder, then refresh or rebuild the index if needed.
3. Left-click a thumbnail to select it. Right-click it to open Scene Details in
   a separate window; use the expand icon on a card for a large image or video
   preview.
4. Use **Favorites**, **Recently Displayed**, tags, or search to find assets.
5. In Scene Details, use the left-side tabs to switch between Info, Grid,
   Vision, Journal, Audio, and Initial View settings. Journal Entries, Playlists, and
   Playlist Sounds can be dragged onto their fields as an alternative to the
   dropdowns; use the clear button at the end of either field to remove a link.
6. Click **Display** to apply the image and its saved Scene preset to the active
   Scene. Use **Remove scene image** to clear the background.

### Virtual folders

Use the **Create virtual folder** button beside **Virtual folders** in the
sidebar. Select images using the square beside each title (or **Select shown**),
then click **Move to folder**. You can also use a thumbnail's folder button or
drag it onto a virtual folder; dragging a selected image moves the whole
selection. Moving an image replaces its previous virtual-folder assignment.
Choose **Remove from virtual folders** in the move dialog to ungroup it.

Virtual folders are saved with the world and shared by its GMs. They show only
media in the current gallery index, so include subfolders or choose the source
directory needed to see the images. Enable **Exclude media from All Media** when
creating or editing a virtual folder to hide its media from All Media, including
searches in that view. Source folders, Favorites, tags, and the virtual folder
still show it. Removing an image from the group or deleting the group makes it
available in All Media again. Uploading while viewing a virtual folder stores files
in the configured base directory and adds them to that virtual folder. The pen
and trash buttons edit and delete groups; deleting a group keeps every file.

## Migration from Share Media Gallery

This module replaces the former `share-media-gallery` module ID. On the first
GM login, it attempts to migrate the former world's selected folder,
subfolder setting, and page size. After confirming the migration, remove the
old module folder so both modules are not enabled at the same time.
