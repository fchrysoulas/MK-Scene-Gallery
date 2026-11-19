import { MODULE_ID } from "./settings.js";
import { normalizeSceneMaps } from "./sceneMapData.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const ACTORS_MODULE_ID = "mk-actors";
let toolbar;

function action(method) {
  return async function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user?.isGM) return;
    try {
      await this[method]();
    } catch (error) {
      console.error(`${MODULE_ID} | Scene Map toolbar action failed: ${method}`, error);
      ui.notifications.error("Could not open this tool. See the console for details.");
    }
  };
}

export class SceneMapToolbar extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-toolbar`,
    tag: "nav",
    classes: ["mg-floating-toolbar"],
    window: { frame: false, positioned: false },
    actions: {
      "open-map": action("_openMap"),
      "open-gallery": action("_openGallery"),
      "open-actors": action("_openActors")
    }
  };

  static PARTS = {
    toolbar: { template: `modules/${MODULE_ID}/templates/scene-map-toolbar.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this._selectedMapId = game.settings.get(MODULE_ID, "lastSceneMap");
    const saved = game.settings.get(MODULE_ID, "sceneMapToolbarPosition");
    this._toolbarPosition = Number.isFinite(saved?.left) && Number.isFinite(saved?.top)
      ? { left: saved.left, top: saved.top } : null;
    this._settingHook = Hooks.on("updateSetting", (setting) => {
      if (setting.key === `${MODULE_ID}.lastSceneMap`) {
        this._selectedMapId = game.settings.get(MODULE_ID, "lastSceneMap");
      } else if (setting.key !== `${MODULE_ID}.sceneMaps`) return;
      if (this._drag) this._renderPending = true;
      else if (this.rendered) this.render({ force: false });
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const maps = normalizeSceneMaps(game.settings.get(MODULE_ID, "sceneMaps"));
    if (!maps.some((map) => map.id === this._selectedMapId)) this._selectedMapId = maps[0]?.id ?? "";
    const actors = game.modules.get(ACTORS_MODULE_ID);
    return {
      ...context,
      hasMaps: maps.length > 0,
      maps: maps.map((map) => ({ id: map.id, name: map.name, selected: map.id === this._selectedMapId })),
      hasActors: actors?.active === true && typeof actors.api?.open === "function"
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._events?.abort();
    this._events = new AbortController();
    const signal = this._events.signal;
    this.element.setAttribute("aria-label", "Scene Map tools");
    this.element.querySelector("select")?.addEventListener("change", (event) => {
      this._selectedMapId = event.target.value;
    }, { signal });
    const handle = this.element.querySelector("[data-role='toolbar-handle']");
    handle.addEventListener("pointerdown", (event) => this._startDrag(event), { signal });
    handle.addEventListener("keydown", (event) => this._moveWithKeyboard(event), { signal });
    this.element.addEventListener("pointermove", (event) => this._moveDrag(event), { signal });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.element.addEventListener(type, (event) => this._finishDrag(event), { signal });
    }
    this.element.ownerDocument.defaultView.addEventListener("resize", () => this._applyToolbarPosition(), { signal });
    this._applyToolbarPosition();
  }

  _applyToolbarPosition(position = this._toolbarPosition) {
    const root = this.element;
    const rect = root.getBoundingClientRect();
    const view = root.ownerDocument.defaultView;
    this._toolbarPosition = {
      left: Math.max(0, Math.min(Math.round(position?.left ?? rect.left), Math.floor(view.innerWidth - rect.width))),
      top: Math.max(0, Math.min(Math.round(position?.top ?? rect.top), Math.floor(view.innerHeight - rect.height)))
    };
    root.style.left = `${this._toolbarPosition.left}px`;
    root.style.top = `${this._toolbarPosition.top}px`;
    root.style.transform = "none";
  }

  _startDrag(event) {
    if (event.button !== 0 || this._drag) return;
    event.preventDefault();
    event.stopPropagation();
    this._drag = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      origin: { ...this._toolbarPosition }, moved: false
    };
    this.element.setPointerCapture(event.pointerId);
    this.element.classList.add("is-dragging");
  }

  _moveDrag(event) {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    this._applyToolbarPosition({ left: drag.origin.left + dx, top: drag.origin.top + dy });
  }

  _finishDrag(event) {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this._drag = null;
    this.element.classList.remove("is-dragging");
    if (this.element.hasPointerCapture(drag.pointerId)) this.element.releasePointerCapture(drag.pointerId);
    if (event.type === "pointercancel") this._applyToolbarPosition(drag.origin);
    else if (drag.moved) void this._saveToolbarPosition();
    if (this._renderPending && this.rendered) {
      this._renderPending = false;
      this.render({ force: false });
    }
  }

  _moveWithKeyboard(event) {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction || this._drag) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 50 : 10;
    this._applyToolbarPosition({
      left: this._toolbarPosition.left + direction[0] * step,
      top: this._toolbarPosition.top + direction[1] * step
    });
    void this._saveToolbarPosition();
  }

  async _saveToolbarPosition() {
    try {
      await game.settings.set(MODULE_ID, "sceneMapToolbarPosition", { ...this._toolbarPosition });
    } catch (error) {
      console.error(`${MODULE_ID} | Could not save Scene Map toolbar position`, error);
      ui.notifications.error("Could not save the toolbar position.");
    }
  }

  async _openMap() {
    const mapId = this.element.querySelector("select")?.value || undefined;
    await game.modules.get(MODULE_ID)?.api?.openSceneMap({ mapId });
  }

  async _openGallery() {
    await game.modules.get(MODULE_ID)?.api?.open();
  }

  async _openActors() {
    const actors = game.modules.get(ACTORS_MODULE_ID);
    if (!actors?.active || typeof actors.api?.open !== "function") {
      ui.notifications.warn("Enable MK Actors to open its gallery.");
      return;
    }
    // Keep the API as the receiver: MK Actors stores its app on this object.
    await actors.api.open();
  }

  _onClose(options) {
    if (this._drag) this._finishDrag({ pointerId: this._drag.pointerId, type: "pointercancel" });
    Hooks.off("updateSetting", this._settingHook);
    this._events?.abort();
    if (toolbar === this) toolbar = null;
    super._onClose(options);
  }
}

export async function renderSceneMapToolbar() {
  if (!game.user?.isGM) return null;
  toolbar ??= new SceneMapToolbar();
  await toolbar.render({ force: true });
  return toolbar;
}
