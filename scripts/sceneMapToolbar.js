import { MODULE_ID } from "./settings.js";
import { applySceneGridSize, getSceneGridSliderData, getSelectedScene } from "./sceneGrid.js";

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
    const saved = game.settings.get(MODULE_ID, "sceneMapToolbarPosition");
    this._toolbarPosition = Number.isFinite(saved?.left) && Number.isFinite(saved?.top)
      ? { left: saved.left, top: saved.top } : null;
    this._hookIds = [
      ["updateSetting", Hooks.on("updateSetting", (setting) => {
        if (setting.key === `${MODULE_ID}.gridSizeMax`) this._refreshGridControls();
      })],
      ["updateScene", Hooks.on("updateScene", (scene, changes) => {
        if (scene.id !== getSelectedScene()?.id) return;
        if (changes?.grid || Object.hasOwn(changes ?? {}, "grid.size")) this._refreshGridControls();
      })],
      ["canvasReady", Hooks.on("canvasReady", () => this._refreshGridControls())],
      ["canvasTearDown", Hooks.on("canvasTearDown", () => this._refreshGridControls({ disabled: true }))]
    ];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actors = game.modules.get(ACTORS_MODULE_ID);
    return {
      ...context,
      grid: getSceneGridSliderData(),
      hasActors: actors?.active === true && typeof actors.api?.open === "function"
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._events?.abort();
    this._events = new AbortController();
    const signal = this._events.signal;
    this.element.setAttribute("aria-label", "Scene Map tools");
    this.element.setAttribute("aria-description", "Drag the panel or its edges to move the toolbar. When focused, use arrow keys; hold Shift to move faster.");
    this.element.title = "Drag the panel or its edges to move. Arrow keys move the focused toolbar; Shift moves faster.";
    this.element.tabIndex = 0;
    const slider = this.element.querySelector("[data-role='grid-size']");
    slider?.addEventListener("input", (event) => {
      this.element.querySelector("[data-role='grid-size-value']").textContent = event.currentTarget.value;
    }, { signal });
    slider?.addEventListener("change", (event) => void this._changeGridSize(event), { signal });
    this.element.addEventListener("pointerdown", (event) => this._startDrag(event), { signal });
    this.element.addEventListener("keydown", (event) => this._moveWithKeyboard(event), { signal });
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
    if (event.target.closest("button, input, select, textarea, a, [contenteditable], [role='button'], [role='slider']")) return;
    event.preventDefault();
    event.stopPropagation();
    this.element.focus({ preventScroll: true });
    this._drag = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      origin: { ...this._toolbarPosition }, moved: false
    };
    this.element.setPointerCapture(event.pointerId);
  }

  _moveDrag(event) {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      this.element.classList.add("is-dragging");
    }
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
  }

  _moveWithKeyboard(event) {
    if (event.target !== this.element) return;
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
    await game.modules.get(MODULE_ID)?.api?.openSceneMap();
  }

  _refreshGridControls({ disabled = false } = {}) {
    const root = this.element;
    const slider = root?.querySelector("[data-role='grid-size']");
    if (!slider) return;
    const grid = getSceneGridSliderData();
    slider.min = grid.min;
    slider.max = grid.max;
    slider.step = grid.step;
    slider.value = grid.value;
    slider.disabled = disabled || grid.disabled || !!this._gridChanging;
    root.querySelector("[data-role='grid-size-value']").textContent = grid.label;
    root.querySelector("[data-role='grid-size-control']").title = grid.title;
  }

  async _changeGridSize(event) {
    const scene = getSelectedScene();
    if (!scene || this._gridChanging) return;
    this._gridChanging = true;
    event.currentTarget.disabled = true;
    try {
      await applySceneGridSize(scene, event.currentTarget.value, { notifyOnSuccess: true });
    } finally {
      this._gridChanging = false;
      this._refreshGridControls();
    }
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
    for (const [name, id] of this._hookIds) Hooks.off(name, id);
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
