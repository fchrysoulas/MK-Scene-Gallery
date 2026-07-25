# AGENTS.md

## Project overview

MK-Scene-Gallery is a Foundry VTT v12–v13 module written as browser-native ES
modules. It provides a folder-based image gallery and its own scene Token Layer
renderer.

There is no build step, package manager, or automated test suite in this
repository. Source files are loaded directly by Foundry.

## Repository layout

- `module.json`: Foundry package manifest and release metadata.
- `scripts/main.js`: Foundry hook registration and application entry point.
- `scripts/app.js`: Gallery ApplicationV2 behavior and UI state.
- `scripts/imageDetails.js`: Standalone image Scene Details ApplicationV2 window.
- `scripts/fileIndex.js`: Image discovery and index caching.
- `scripts/lighting.js`: Ambient Light scaling for Scene grid-size changes.
- `scripts/settings.js`: Module settings and legacy setting migration.
- `scripts/scenePresets.js`: Per-image Scene preset normalization and application.
- `scripts/tokenLayer.js`: Scene Token Layer image renderer.
- `scripts/transitions.js`: Token Layer fade transition timing and animation.
- `templates/gallery.hbs`: Handlebars application template.
- `styles/gallery.css`: Gallery styles.

## Development conventions

- Use modern JavaScript ES modules and two-space indentation.
- Preserve compatibility with Foundry VTT v12 and ApplicationV2.
- Use the exported `MODULE_ID` instead of repeating the module ID in JavaScript.
- Treat paths passed to `FilePicker` as Foundry data-source paths, not operating
  system paths.
- Keep gallery folder state, filtering, pagination, and indexing behavior
  consistent when changing upload or navigation flows.
- Use Foundry notifications for user-facing success and failure feedback.
- Log actionable errors with the module ID before showing a concise notification.
- Keep template behavior in `gallery.hbs` and visual styling in `gallery.css`;
  avoid embedding markup or CSS in JavaScript.
- Do not edit or commit `release.ps1`; it is a local release helper and is
  intentionally ignored.

## Validation

Run these checks after relevant changes:

```powershell
node --check scripts/app.js
node --check scripts/imageDetails.js
node --check scripts/main.js
node --check scripts/fileIndex.js
node --check scripts/lighting.js
node --check scripts/settings.js
node --check scripts/scenePresets.js
node --check scripts/tokenLayer.js
node --check scripts/transitions.js
node -e "JSON.parse(require('fs').readFileSync('module.json', 'utf8'))"
git diff --check
```

For UI or Foundry API changes, also test manually in Foundry VTT v12 or v13.

## Local testing

After every source change, sync the affected module files to
`%LOCALAPPDATA%\FoundryVTT\Data\modules\mk-scene-gallery` and test the result at
`http://192.168.1.69:30000/`.

## Versioning and releases

- Follow semantic versioning in `module.json`.
- When changing the version, update the version segment in `download` to the
  matching `v<version>` GitHub release tag.
- Keep `url`, `manifest`, and `download` as the final properties in
  `module.json`, in that order.
- The downloadable archive must be named `mk-scene-gallery.zip`.
- The release must attach both `module.json` and `mk-scene-gallery.zip`.
- Do not commit generated release output.
