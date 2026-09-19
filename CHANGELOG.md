# Changelog

All notable changes to MK-Scene-Gallery are documented here.

## Unreleased

## 0.11.3

- Preserved fully-qualified Forge and CDN media URLs so gallery thumbnails and
  previews do not rewrite them as invalid local Foundry routes.

## 0.11.2

- Fixed image and video previews on Foundry VTT v14 by normalizing media URLs
  to root-relative server routes.
- Synchronized ApplicationV2 preview rendering with v14 application lifecycle
  updates.

## 0.11.1

- Added explicit WebP upload support; WebP files can be previewed and assigned
  as Scene backgrounds like other gallery images.

## 0.11.0

- Redesigned Scene Details with compact navigation, Foundry-style settings, and
  a streamlined Basics section.
- Expanded image presets for grid, lighting, vision, initial view, Journal, and
  audio settings, including section-level copying from the active Scene.
- Improved gallery navigation with a collapsible folder sidebar and remembered
  window, folder, and display preferences.
- Added incremental media loading and a 30-item recent gallery.
- Improved gallery responsiveness and rendering performance.

## 0.10.4

- Added MK Module Hub Metadata Standard v1 metadata and a runtime gallery-open
  integration.

## 0.10.3

- Prevented flicker while transitioning Scene backgrounds.
- Corrected the Ko-fi username.

- Added GitHub funding metadata.

## 0.10.2

- Added support for Foundry VTT v13 and v14.
- Added fade transitions when Scene backgrounds change.

## 0.10.0

- Added folder-based gallery browsing with optional subfolders.
- Added image uploads, indexing, refresh, and pagination.
- Added image titles, descriptions, custom tags, Favorites, and Recently Displayed views.
- Added per-image Scene presets, including grid appearance, scale, lighting, fog, weather, background color, view, linked Journals, and Playlist Sounds.
- Added native Scene background image and looping WebM video controls.
- Added Scene Details editing and the ability to copy supported settings from the active Scene.
- Added inverse Ambient Light scaling when Scene grid size changes.
- Added image-title font-size and maximum Scene grid-size settings.
- Replaced the former `share-media-gallery` package ID with `mk-scene-gallery` and added legacy setting migration.
