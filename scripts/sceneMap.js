import { MODULE_ID } from "./settings.js";
import { getMediaType } from "./fileIndex.js";
import { getSceneBackground } from "./sceneBackground.js";
import { normalizeSceneMaps, removeSceneMapNode, toggleSceneMapLink } from "./sceneMapData.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 158;
const MEDIA_DRAG_TYPE = `application/x-${MODULE_ID}`;
let sceneMapApp;

function action(method) {
  return async function (event, target) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await this[method](target);
    } catch (error) {
      console.error(`${MODULE_ID} | Scene Map action failed: ${method}`, error);
      ui.notifications.error("Could not update Scene Map. See the console for details.");
    }
  };
}

export async function openSceneMap({ gallery, paths = [] } = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only Game Masters can open Scene Maps.");
    return null;
  }
  if (!sceneMapApp) sceneMapApp = new SceneMapApp({ gallery });
  if (gallery) sceneMapApp.gallery = gallery;
  await sceneMapApp.render({ force: true });
  if (sceneMapApp.minimized) await sceneMapApp.maximize();
  sceneMapApp.bringToFront();
  if (paths.length) await sceneMapApp.chooseDestination(paths);
  return sceneMapApp;
}

export class SceneMapApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mk-scene-gallery-scene-map",
    classes: ["mk-scene-gallery", "mg-glass-window", "mg-scene-map-window"],
    position: { width: 1120, height: 760 },
    window: { title: "Scene Maps", icon: "fas fa-diagram-project", resizable: true, minimizable: true },
    actions: {
      "new-map": action("_createMap"),
      "rename-map": action("_renameMap"),
      "duplicate-map": action("_duplicateMap"),
      "delete-map": action("_deleteMap"),
      "open-gallery": action("_openGallery"),
      "add-scene": action("_addScene"),
      "link-mode": action("_toggleLinkMode"),
      "fit-map": action("_fitMap"),
      "zoom-in": action("_zoomIn"),
      "zoom-out": action("_zoomOut"),
      "visit-node": action("_visitNode"),
      "group-here": action("_groupHere"),
      "remove-node": action("_removeNode")
    }
  };

  static PARTS = {
    map: { template: `modules/${MODULE_ID}/templates/scene-map.hbs` }
  };

  constructor({ gallery, ...options } = {}) {
    super(options);
    this.gallery = gallery;
    this.mapId = game.settings.get(MODULE_ID, "lastSceneMap");
    this._views = new Map();
    this._saveQueue = Promise.resolve();
    this._linkMode = false;
    this._linkFrom = "";
    this._travelPending = false;
    const refresh = () => {
      if (this.rendered && !this._drag && !this._saving) this.render({ force: false });
    };
    this._hookIds = [["updateSetting", Hooks.on("updateSetting", (setting) => {
      if (["sceneMaps", "imageMetadata", "imageTitles"].some((key) => setting.key === `${MODULE_ID}.${key}`)) refresh();
    })]];
    for (const hook of ["updateScene", "deleteScene", "updateLevel", "deleteLevel", "canvasReady"]) {
      this._hookIds.push([hook, Hooks.on(hook, refresh)]);
    }
  }

  _maps() {
    return normalizeSceneMaps(game.settings.get(MODULE_ID, "sceneMaps"));
  }

  _map() {
    const maps = this._maps();
    return maps.find((map) => map.id === this.mapId) ?? maps[0] ?? null;
  }

  _view() {
    if (!this._views.has(this.mapId)) this._views.set(this.mapId, { x: 40, y: 40, scale: 1 });
    return this._views.get(this.mapId);
  }

  // Read the latest setting inside the queue so rapid edits do not overwrite one another.
  _write(change) {
    this._saveQueue = this._saveQueue.then(async () => {
      if (!game.user?.isGM) throw new Error("Only Game Masters can edit Scene Maps.");
      const maps = this._maps();
      change(maps);
      this._saving = true;
      try {
        await game.settings.set(MODULE_ID, "sceneMaps", normalizeSceneMaps(maps));
      } finally {
        this._saving = false;
      }
      if (this.rendered) await this.render({ force: false });
      return true;
    }).catch((error) => {
      console.error(`${MODULE_ID} | Could not save Scene Maps`, error);
      ui.notifications.error("Could not save Scene Map. Your last change was not saved.");
      if (this.rendered) this.render({ force: false });
      return false;
    });
    return this._saveQueue;
  }

  _editMap(id, change) {
    return this._write((maps) => {
      const map = maps.find((entry) => entry.id === id);
      if (!map) throw new Error("This Scene Map was removed. Choose another map.");
      change(map);
    });
  }

  async _selectMap(id) {
    this.mapId = id;
    this._linkFrom = "";
    try {
      await game.settings.set(MODULE_ID, "lastSceneMap", id);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not remember the selected Scene Map`, error);
    }
    if (this.rendered) await this.render({ force: false });
  }

  async _prompt(title, data, label, callback) {
    const content = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/scene-map-dialog.hbs`, data
    );
    return DialogV2.prompt({
      window: { title }, position: { width: 440 }, content,
      modal: true, rejectClose: false, ok: { label, callback }
    });
  }

  async _name(title, name = "") {
    return this._prompt(title, { editName: true, name }, "Save", (_event, button) =>
      button.form.elements.mapName.value.trim().slice(0, 100));
  }

  async _createMap() {
    const name = await this._name("Create Scene Map");
    if (!name) return null;
    const id = foundry.utils.randomID();
    const saved = await this._write((maps) => maps.push({ id, name, nodes: [], links: [], partyNodeId: "" }));
    if (!saved) return null;
    await this._selectMap(id);
    ui.notifications.info(`Created Scene Map: ${name}.`);
    return id;
  }

  async _renameMap() {
    const map = this._map();
    if (!map) return;
    const name = await this._name("Rename Scene Map", map.name);
    if (name && await this._editMap(map.id, (entry) => { entry.name = name; })) {
      ui.notifications.info(`Renamed Scene Map to ${name}.`);
    }
  }

  async _duplicateMap() {
    const map = this._map();
    if (!map) return;
    const name = await this._name("Duplicate Scene Map", `${map.name} (copy)`);
    if (!name) return;
    // Node IDs are local to a map, so all copied links and the marker remain valid.
    const copy = { ...map, id: foundry.utils.randomID(), name };
    if (await this._write((maps) => maps.push(copy))) {
      await this._selectMap(copy.id);
      ui.notifications.info(`Duplicated Scene Map: ${name}.`);
    }
  }

  async _deleteMap() {
    const map = this._map();
    if (!map) return;
    const confirmed = await this._prompt("Delete Scene Map", { deleteMap: true, name: map.name },
      "Delete map", () => true);
    if (!confirmed) return;
    if (await this._write((maps) => {
      const index = maps.findIndex((entry) => entry.id === map.id);
      if (index >= 0) maps.splice(index, 1);
    })) {
      this._views.delete(map.id);
      await this._selectMap(this._maps()[0]?.id ?? "");
      ui.notifications.info(`Deleted Scene Map: ${map.name}.`);
    }
  }

  async chooseDestination(paths) {
    let maps = this._maps();
    if (!maps.length && !await this._createMap()) return;
    maps = this._maps();
    let id = this._map()?.id;
    if (maps.length > 1) {
      id = await this._prompt("Add to Scene Map", {
        chooseMap: true, count: paths.length,
        maps: maps.map((map) => ({ ...map, selected: map.id === id }))
      }, "Add", (_event, button) => button.form.elements.mapId.value);
    }
    if (!id) return;
    await this._selectMap(id);
    await this.addImages(paths);
    this._fitMap();
  }

  async addImages(paths, position) {
    const map = this._map();
    if (!map) {
      ui.notifications.warn("Create a Scene Map before adding images.");
      return;
    }
    const unique = [...new Set(paths)].filter((path) => typeof path === "string" && getMediaType(path));
    if (!unique.length) return;
    let added = 0;
    const saved = await this._editMap(map.id, (entry) => {
      const origin = position ?? this._visibleOrigin();
      for (const path of unique) {
        if (entry.nodes.some((node) => !node.sceneId && node.path === path)) continue;
        let index = added++;
        if (!position) {
          while (entry.nodes.some((node) =>
            Math.abs(node.x - (origin.x + (index % 4) * (NODE_WIDTH + 40))) < NODE_WIDTH + 20
            && Math.abs(node.y - (origin.y + Math.floor(index / 4) * (NODE_HEIGHT + 40))) < NODE_HEIGHT + 20)) index++;
        }
        entry.nodes.push({
          id: foundry.utils.randomID(), path, sceneId: "",
          x: origin.x + (index % 4) * (NODE_WIDTH + 40),
          y: origin.y + Math.floor(index / 4) * (NODE_HEIGHT + 40)
        });
      }
    });
    if (saved) ui.notifications.info(added
      ? `Added ${added} media item${added === 1 ? "" : "s"} to ${map.name}.`
      : "These images are already on this Scene Map.");
  }

  async _openGallery() {
    game.modules.get(MODULE_ID)?.api?.open();
    ui.notifications.info("Use Add to Scene Map on gallery images, or drag them onto the map.");
  }

  async _addScene() {
    const mapId = this._map()?.id;
    if (!mapId) return;
    const scenes = Array.from(game.scenes ?? []).map((scene) => ({ id: scene.id, name: scene.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!scenes.length) {
      ui.notifications.warn("Create a Foundry Scene first.");
      return;
    }
    const sceneId = await this._prompt("Add Foundry Scene", { addScene: true, scenes }, "Add",
      (_event, button) => button.form.elements.sceneId.value);
    if (sceneId) await this._insertScene(sceneId, this._visibleOrigin(), mapId);
  }

  async _insertScene(sceneId, position, mapId = this._map()?.id) {
    const scene = game.scenes.get(sceneId);
    if (!scene || !mapId) return;
    const saved = await this._editMap(mapId, (map) => {
      if (map.nodes.some((node) => node.sceneId === sceneId)) return;
      map.nodes.push({
        id: foundry.utils.randomID(), sceneId,
        path: getSceneBackground(scene)?.path ?? "", ...position
      });
    });
    if (saved) ui.notifications.info(`${scene.name} is on the Scene Map.`);
  }

  _nodeData(node, map) {
    const scene = node.sceneId ? game.scenes.get(node.sceneId) : null;
    const path = node.sceneId ? getSceneBackground(scene)?.path ?? node.path : node.path;
    const metadata = game.settings.get(MODULE_ID, "imageMetadata")?.[path];
    const titles = game.settings.get(MODULE_ID, "imageTitles");
    let fileName = path.split("/").pop() || "Scene";
    try { fileName = decodeURIComponent(fileName); } catch { /* Keep the original file name. */ }
    const label = scene?.name || metadata?.title || titles?.[path] || fileName;
    return {
      ...node, path, label, isScene: !!node.sceneId, missing: !!node.sceneId && !scene,
      url: path ? this.gallery?._toServedUrl(path) ?? path : "",
      isVideo: getMediaType(path) === "video",
      party: node.id === map.partyNodeId,
      linkSource: this._linkFrom === node.id
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const maps = this._maps();
    const map = maps.find((entry) => entry.id === this.mapId) ?? maps[0];
    this.mapId = map?.id ?? "";
    if (!map?.nodes.some((node) => node.id === this._linkFrom)) this._linkFrom = "";
    const nodes = map?.nodes.map((node) => this._nodeData(node, map)) ?? [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return {
      ...context, hasMap: !!map, hasNodes: !!nodes.length,
      maps: maps.map((entry) => ({ id: entry.id, name: entry.name, selected: entry.id === this.mapId })),
      mapName: map?.name, nodes, nodeCount: nodes.length, linkCount: map?.links.length ?? 0,
      partyLabel: byId.get(map?.partyNodeId)?.label ?? "Not placed",
      activeScene: game.scenes?.active?.name ?? "No active Scene",
      linkMode: this._linkMode,
      instruction: this._linkMode
        ? (this._linkFrom ? "Choose another image to add or remove its link. Escape cancels." : "Click two images to add or remove a connection.")
        : "Click an image or Group here to travel. Drag its title to arrange. Drag empty space to pan; scroll to zoom.",
      links: (map?.links ?? []).map((link) => {
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        return {
          x1: from.x + NODE_WIDTH / 2, y1: from.y + NODE_HEIGHT / 2,
          x2: to.x + NODE_WIDTH / 2, y2: to.y + NODE_HEIGHT / 2,
          traveled: from.party || to.party
        };
      })
    };
  }

  _toggleLinkMode() {
    this._linkMode = !this._linkMode;
    this._linkFrom = "";
    this.render({ force: false });
  }

  async _visitNode(target) {
    if (this._suppressClick || this._travelPending) return;
    const map = this._map();
    const id = target.dataset.nodeId;
    const node = map?.nodes.find((entry) => entry.id === id);
    if (!node) return;
    if (this._linkMode) {
      const from = this._linkFrom;
      this._linkFrom = from === id ? "" : id;
      if (from && from !== id) {
        this._linkFrom = "";
        await this._editMap(map.id, (entry) => toggleSceneMapLink(entry, from, id));
      } else this.render({ force: false });
      return;
    }
    await this._groupHere(target);
  }

  async _groupHere(target) {
    if (this._suppressClick || this._travelPending) return;
    const map = this._map();
    const id = target.dataset.nodeId;
    const node = map?.nodes.find((entry) => entry.id === id);
    if (!node) return;
    this._travelPending = true;
    this.element?.classList.add("is-traveling");
    try {
      if (node.sceneId) {
        const scene = game.scenes.get(node.sceneId);
        if (!scene) {
          ui.notifications.warn("This Foundry Scene no longer exists. Remove it from the map and add another.");
          return;
        }
        await scene.activate();
        await scene.view();
      } else {
        const activeScene = game.scenes?.active;
        if (!activeScene) {
          ui.notifications.warn("Activate a Foundry Scene before displaying a map image.");
          return;
        }
        const displayed = await this.gallery?._displayImage(node.path, activeScene);
        if (!displayed) return;
      }
      const saved = await this._editMap(map.id, (entry) => {
        if (entry.nodes.some((candidate) => candidate.id === id)) entry.partyNodeId = id;
      });
      if (saved) ui.notifications.info(`Group moved to ${this._nodeData(node, map).label}.`);
    } finally {
      this._travelPending = false;
      this.element?.classList.remove("is-traveling");
    }
  }

  async _removeNode(target) {
    const map = this._map();
    if (!map) return;
    const id = target.dataset.nodeId;
    await this._editMap(map.id, (entry) => removeSceneMapNode(entry, id));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const firstView = !this._views.has(this.mapId);
    this._events?.abort();
    this._events = new AbortController();
    const signal = this._events.signal;
    const root = this.element;
    root.querySelector("[data-role='map-select']")?.addEventListener("change", (event) => {
      this._selectMap(event.target.value);
    }, { signal });
    const viewport = root.querySelector(".mg-map-viewport");
    viewport.addEventListener("pointerdown", (event) => this._pointerDown(event), { signal });
    viewport.addEventListener("pointermove", (event) => this._pointerMove(event), { signal });
    viewport.addEventListener("pointerup", (event) => this._pointerUp(event), { signal });
    viewport.addEventListener("pointercancel", () => this._cancelDrag(), { signal });
    viewport.addEventListener("lostpointercapture", () => this._cancelDrag(), { signal });
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      this._zoom(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
    }, { signal, passive: false });
    viewport.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }, { signal });
    viewport.addEventListener("drop", (event) => this._drop(event), { signal });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this._linkMode) return;
      event.preventDefault();
      event.stopPropagation();
      this._linkMode = false;
      this._linkFrom = "";
      this.render({ force: false });
    }, { signal });
    if (firstView) this._fitMap();
    else this._applyView();
  }

  _point(clientX, clientY) {
    const rect = this.element.querySelector(".mg-map-viewport").getBoundingClientRect();
    const view = this._view();
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  }

  _visibleOrigin() {
    const view = this._view();
    return { x: (30 - view.x) / view.scale, y: (30 - view.y) / view.scale };
  }

  _applyView() {
    const view = this._view();
    const world = this.element?.querySelector(".mg-map-world");
    if (world) world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const output = this.element?.querySelector("[data-role='map-zoom']");
    if (output) output.textContent = `${Math.round(view.scale * 100)}%`;
  }

  _zoom(factor, clientX, clientY) {
    const viewport = this.element?.querySelector(".mg-map-viewport");
    if (!viewport || this._drag) return;
    const rect = viewport.getBoundingClientRect();
    const x = clientX ?? rect.left + rect.width / 2;
    const y = clientY ?? rect.top + rect.height / 2;
    const point = this._point(x, y);
    const view = this._view();
    view.scale = Math.min(2, Math.max(0.05, view.scale * factor));
    view.x = x - rect.left - point.x * view.scale;
    view.y = y - rect.top - point.y * view.scale;
    this._applyView();
  }

  _zoomIn() { this._zoom(1.2); }
  _zoomOut() { this._zoom(1 / 1.2); }

  _fitMap() {
    const map = this._map();
    const viewport = this.element?.querySelector(".mg-map-viewport");
    if (!viewport) return;
    const view = this._view();
    if (!map?.nodes.length) {
      Object.assign(view, { x: 40, y: 40, scale: 1 });
    } else {
      const minX = Math.min(...map.nodes.map((node) => node.x));
      const minY = Math.min(...map.nodes.map((node) => node.y));
      const width = Math.max(...map.nodes.map((node) => node.x)) + NODE_WIDTH - minX;
      const height = Math.max(...map.nodes.map((node) => node.y)) + NODE_HEIGHT - minY;
      view.scale = Math.min(1.2, Math.max(0.05,
        Math.min((viewport.clientWidth - 80) / width, (viewport.clientHeight - 80) / height)));
      view.x = (viewport.clientWidth - width * view.scale) / 2 - minX * view.scale;
      view.y = (viewport.clientHeight - height * view.scale) / 2 - minY * view.scale;
    }
    this._applyView();
  }

  _pointerDown(event) {
    if (this._drag || ![0, 1].includes(event.button)) return;
    const handle = event.target.closest("[data-role='node-handle']");
    if (!handle && event.target.closest(".mg-map-node, button, input, select, .mg-map-empty")) return;
    if (!this._map()) return;
    event.preventDefault();
    event.stopPropagation();
    const id = handle?.closest(".mg-map-node")?.dataset.nodeId;
    const node = this._map().nodes.find((entry) => entry.id === id);
    this._drag = {
      id, mapId: this.mapId, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      x: node?.x ?? this._view().x, y: node?.y ?? this._view().y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
  }

  _pointerMove(event) {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.id) {
      drag.position = {
        x: Math.min(100000, Math.max(-100000, drag.x + dx / this._view().scale)),
        y: Math.min(100000, Math.max(-100000, drag.y + dy / this._view().scale))
      };
      const card = Array.from(this.element.querySelectorAll(".mg-map-node"))
        .find((element) => element.dataset.nodeId === drag.id);
      if (card) {
        card.style.left = `${drag.position.x}px`;
        card.style.top = `${drag.position.y}px`;
      }
      // Lines are cheap to update and stay attached while the card is moving.
      const map = this._map();
      const nodes = new Map(map.nodes.map((node) => [node.id, node]));
      nodes.set(drag.id, { ...nodes.get(drag.id), ...drag.position });
      this.element.querySelectorAll(".mg-map-links line").forEach((line, index) => {
        const link = map.links[index];
        if (!link) return;
        for (const [suffix, id] of [["1", link.from], ["2", link.to]]) {
          const node = nodes.get(id);
          line.setAttribute(`x${suffix}`, node.x + NODE_WIDTH / 2);
          line.setAttribute(`y${suffix}`, node.y + NODE_HEIGHT / 2);
        }
      });
    } else {
      Object.assign(this._view(), { x: drag.x + dx, y: drag.y + dy });
      this._applyView();
    }
  }

  async _pointerUp(event) {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this._drag = null;
    this._suppressClick = drag.moved;
    clearTimeout(this._clickTimer);
    this._clickTimer = setTimeout(() => { this._suppressClick = false; }, 100);
    event.currentTarget.classList.remove("is-dragging");
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.id && drag.position) {
      await this._editMap(drag.mapId, (map) => {
        const node = map.nodes.find((entry) => entry.id === drag.id);
        if (node) Object.assign(node, drag.position);
      });
    }
  }

  _cancelDrag() {
    if (!this._drag) return;
    this._drag = null;
    this.element?.querySelector(".mg-map-viewport")?.classList.remove("is-dragging");
    if (this.rendered) this.render({ force: false });
  }

  async _drop(event) {
    event.preventDefault();
    event.stopPropagation();
    const position = this._point(event.clientX, event.clientY);
    const mapId = this._map()?.id;
    if (!mapId) {
      ui.notifications.warn("Create a Scene Map before dropping media or Scenes.");
      return;
    }
    try {
      const media = event.dataTransfer?.getData(MEDIA_DRAG_TYPE);
      if (media) {
        const paths = JSON.parse(media);
        if (Array.isArray(paths)) await this.addImages(paths, position);
        return;
      }
      const raw = event.dataTransfer?.getData("text/plain");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.type !== "Scene" || typeof data.uuid !== "string") return;
      const scene = await fromUuid(data.uuid);
      if (scene?.documentName === "Scene" && game.scenes.get(scene.id) === scene) {
        await this._insertScene(scene.id, position, mapId);
      } else ui.notifications.warn("Add a Scene from this world to the Scene Map.");
    } catch (error) {
      console.error(`${MODULE_ID} | Could not drop onto Scene Map`, error);
      ui.notifications.error("Could not add this item to the Scene Map.");
    }
  }

  async close(options = {}) {
    await this._saveQueue;
    return super.close(options);
  }

  _onClose(options) {
    for (const [hook, id] of this._hookIds) Hooks.off(hook, id);
    this._events?.abort();
    clearTimeout(this._clickTimer);
    if (sceneMapApp === this) sceneMapApp = null;
    super._onClose(options);
  }
}
