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
- Create multiple Scene Maps with draggable image and Foundry Scene nodes,
  connections, and a separate group-location marker on each map.
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

### Scene transitions

Choose an effect from the wand dropdown in the gallery toolbar or from **Module
Settings > MK-Scene-Gallery > Scene transition effect**. Effects include Fade,
directional wipes, split, alternating bars, clock, radial, diamond, wave, melt,
pixelate, zoom, and spiral. **None** disables transitions for the world. The
**Scene transition duration** setting applies to each client; set it to zero to
disable effects on that client. Existing fade-duration preferences are retained.

The selected effect applies to native background changes, including gallery
Display and Scene Map image places. Traveling to a linked Foundry Scene through
a Scene Map holds a snapshot of the old Scene while the next one loads, then
reveals it using the same effect. Players follow the activated Scene and use
their own transition duration. Other GMs keep their own viewed Scene.

Macros can activate a Scene with the same transition:

```js
await game.modules.get("mk-scene-gallery").api.activateScene("your-scene-id");
```

This incorporates selected effects and snapshot techniques from
[Battle Transitions by Unarekin](https://github.com/Unarekin/FoundryVTT-Battle-Transitions),
adapted for native Foundry v13-v14 backgrounds without additional dependencies.
The upstream sequence editor and sample macros are not included. Its MIT notice
is preserved in [scripts/vendor/battle-transitions.LICENSE.txt](scripts/vendor/battle-transitions.LICENSE.txt).

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
creating or editing a virtual folder to hide its media from All Media, its source
subfolders, and searches in those views. Favorites, Recently Displayed, tags, and
the virtual folder still show it. Removing an image from the group or deleting
the group restores it to All Media and its source subfolders. Uploading while
viewing a virtual folder stores files in the configured base directory and adds
them to that virtual folder. The pen and trash buttons edit and delete groups;
deleting a group keeps every file.

### Scene Maps

GMs have an always-on-top toolbar near the top of the screen, even while the
gallery and Scene Maps are closed. Its icon buttons open **Scene Maps**, the
**Scene Gallery**, and **MK Actors** when that module is enabled; hover over a
button for its name. Scene Maps opens the last-used map and lets you select maps
inside its window. With no maps yet, it lets you create the first one. The battle
grid-size slider changes the selected/viewed Scene's grid size and preserves
Ambient Light coverage, just like the gallery slider.
Drag the toolbar's panel or edges to move it. Its position is saved on this
client and kept within the screen. You can also focus the toolbar itself and
use arrow keys to move it, holding Shift for larger steps. Buttons and the grid
slider keep their normal controls.
The hand cursor indicates draggable areas and changes to a grabbing hand while
moving the toolbar.

Open **Scene Maps** in the gallery toolbar and click **New map**. Name maps for
different adventures, chapters, dungeons, or regions, then switch between them
with the map dropdown. Rename, duplicate, and delete maps beside the dropdown.
Layouts, links, and group locations are saved with the world and shared by GMs.

Use a gallery image's **Add to Scene Map** button, or select several images and
use **Add to Scene Map** in the selection bar. With multiple maps, choose the
destination in the dialog. You can also drag gallery images onto the map; adding
them keeps their files and virtual-folder assignments in place. Images can
appear in more than one map and remain usable after changing gallery folders.

Drag node titles to arrange them. Click **Link images**, then click two images
to connect them; repeat the same pair to remove a connection. Click **Done
linking** or press Escape to return to traveling. Drag empty canvas space to pan,
scroll to zoom, and use **Fit** to see the layout.

Click an image or its **Group here** button to apply its background and saved
Scene preset to the **selected/viewed Scene**, and move this map's group marker
after success. The marker records one group location per map; links show
possible routes and do not restrict travel.

Use **Add Scene** or drag a Scene from Foundry's sidebar to link an existing
world Scene. Clicking that node or its **Group here** button activates its Scene
for the players and opens it for the GM. The remove button only removes a node
and its connections from the map. Deleting a map keeps all media files and
Foundry Scenes.

Drop Actors from the sidebar or a compendium onto a place to attach characters.
Click its character-count button to inspect attachments or detach them. You can
also select tokens on the Foundry canvas and click **Attach selected canvas
tokens** in the Characters panel to save their appearance, state, and position.
Repeated Actor drops add multiple copies, useful for groups of the same NPC.

Click **Save** on a place to capture its Scene background (including placement),
Scene dimensions, exact grid size, current view, and all actor tokens with their
positions and state. Image places capture the selected/viewed Scene; linked
Foundry Scene places capture their own Scene. **Update** replaces the saved
snapshot with the current Scene, including additions and removals of characters.
Each place keeps its own snapshot, even when places use the same image. Loading
the place restores it. Saved canvas tokens become part of that place and swap
out when another place is loaded on the same Scene.

Loading a place through its image or **Group here** places its attached tokens.
New Actors appear near the Scene center; attached canvas tokens keep their saved
positions. Revisiting does not duplicate tokens already present. When another
place uses the same Foundry Scene, Scene Map tokens are swapped and their latest
positions and state are remembered. Other Scene tokens stay in place. Detaching
a character takes effect when you next load that place. Compendium Actors are
imported into the world when first needed.

Macros can open the map window with
`game.modules.get("mk-scene-gallery").api.openSceneMap()`.
Pass `{ mapId: "your-map-id" }` to open a specific map.

## Migration from Share Media Gallery

This module replaces the former `share-media-gallery` module ID. On the first
GM login, it attempts to migrate the former world's selected folder,
subfolder setting, and page size. After confirming the migration, remove the
old module folder so both modules are not enabled at the same time.
