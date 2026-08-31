# Changelog

All notable changes to MK-Scene-Gallery are documented here.

## Unreleased

- Changed thumbnail interactions so left-click selects, right-click opens Scene
  Details in a separate window, and the card preview action remains available.
- Added Scene Details tabs for Info, Grid, Vision, Journal, Audio, and Initial
  View, plus drag-and-drop Journal Entry and Playlist linking. Linked Journal
  Entries now open and linked audio now starts automatically, with
  clear-selection controls.

## 0.10.4

### Added

- Added MK Module Hub Metadata Standard v1 metadata and a runtime gallery-open
  integration.

## 0.10.3

### Fixed

- Prevented flicker while transitioning Scene backgrounds.
- Corrected the Ko-fi username.

### Added

- Added GitHub funding metadata.

## 0.10.2

### Added

- Added support for Foundry VTT v13 and v14.
- Added fade transitions when Scene backgrounds change.

## 0.10.0

### Added

- Added folder-based gallery browsing with optional subfolders.
- Added image uploads, indexing, refresh, and pagination.
- Added image titles, descriptions, custom tags, Favorites, and Recently Displayed views.
- Added per-image Scene presets, including grid appearance, scale, lighting, fog, weather, background color, view, linked Journals, and Playlist Sounds.
- Added native Scene background image and looping WebM video controls.
- Added Scene Details editing and the ability to copy supported settings from the active Scene.
- Added inverse Ambient Light scaling when Scene grid size changes.
- Added image-title font-size and maximum Scene grid-size settings.

### Changed

- Replaced the former `share-media-gallery` package ID with `mk-scene-gallery` and added legacy setting migration.
