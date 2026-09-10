# Changelog

All notable changes to MK-Scene-Gallery are documented here.

## Unreleased

- Scene Details settings now use Foundry-style label-and-control rows across
  every tab. Initial View is part of the renamed Basics tab and uses a compact
  inline position control.
- Scene Details now uses labeled section navigation, a compact image header with
  media and preset status badges, a sticky action footer, and visible unsaved
  change feedback.
- Grid, Light Sources, Vision, and the Basics Initial View controls can copy
  their settings from the active Scene.
- Darkness and Scene padding use sliders with live values and a Keep Current
  reset.
- The Description editor has been removed from Scene Details Info; existing
  saved descriptions remain preserved when other metadata is saved.
- Light Sources scene details now store, copy, and apply the active Scene's
  ambient light sources alongside image presets.
- The folder sidebar is collapsible, remembers its state, centers its compact
  icons, and displays the active folder path in its header.
- The gallery window remembers its last position and size when reopened.
- Gallery results load in batches of 30 as the user approaches the end of the
  list, with a dedicated loading overlay for additional media.
- Gallery rendering uses cached derived data, delegated card interactions,
  limited thumbnail video playback, asynchronous image loading, and lighter
  visual effects for improved performance.
- Gallery text uses a 12px default size, and redundant Quick Access labels,
  icons, and Scene setting guidance have been removed.
- Changed thumbnail interactions so left-click selects, right-click opens Scene
  Details in a separate window, and the card preview action remains available.
- Added Scene Details tabs for Info, Grid, Vision, Journal, Audio, and Initial
  View, plus drag-and-drop Journal Entry and Playlist linking. Linked Journal
  Entries now open and linked audio now starts automatically, with
  clear-selection controls.

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
