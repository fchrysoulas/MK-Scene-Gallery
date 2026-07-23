import { MODULE_ID } from "./settings.js";
import { indexImages, getCachedIndex, clearIndexCache } from "./fileIndex.js";
import { openShareMediaPopout } from "./share.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MediaGalleryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mk-scene-gallery-app",
    classes: ["mk-scene-gallery", "mg-glass-window"],
    position: {
      width: 1100,
      height: 720
    },
    window: {
      title: "MK-Scene-Gallery",
      icon: "fas fa-images",
      resizable: true,
      minimizable: true
    },
    actions: {
      "pick-folder": async function () {
        await this._pickFolder();
      },
      "add-image": async function () {
        await this._addImage();
      },
      "refresh-gallery": async function () {
        await this._refreshGallery();
      },
      "load-more": async function () {
        this._loadMore();
      },
      "select-folder": async function (event, target) {
        this._selectFolder(event, target);
      },
      "toggle-folder": async function (event, target) {
        this._toggleFolder(event, target);
      },
      "toggle-pin-folder": async function (event, target) {
        await this._togglePinnedFolder(event, target);
      },
      "fit-bound-to-scene": async function (event, target) {
        await this._fitBoundingTileToScene(event, target);
      },
      "clear-search": async function () {
        this._clearSearch();
      },
      "share-file": async function (event, target) {
        await this._shareFile(event, target);
      }
    }
  };

  static PARTS = {
    gallery: {
      template: `modules/${MODULE_ID}/templates/gallery.hbs`,
      scrollable: [".mg-tree-scroll"]
    }
  };

  constructor(options = {}) {
    super(options);

    this.files = [];
    this.filter = "";
    this.selected = new Set();
    this.page = 0;

    this.loading = false;
    this._indexed = false;
    this._indexPromise = null;
    this.total = 0;

    this._indexStats = { scannedDirs: 0, queuedDirs: 0, foundFiles: 0 };
    this._lastProgressRender = 0;

    this._openFolders = new Set();
    this._activeFolder = "";
    const savedPins = game.settings.get(MODULE_ID, "pinnedFolders");
    this._pinnedFolders = new Set(
      Array.isArray(savedPins)
        ? savedPins.filter((path) => typeof path === "string" && path.length)
        : []
    );
    this._searchRenderTimer = null;
    this._restoreSearchFocus = false;
    this._sceneHookIds = [];

    this._indexRunId = 0;
    this._isClosing = false;
    this._initialIndexScheduled = false;
    this._isUploading = false;
  }

  async close(options = {}) {
    this._isClosing = true;
    this._indexRunId += 1;
    this.loading = false;
    this._indexPromise = null;
    if (this._searchRenderTimer) {
      clearTimeout(this._searchRenderTimer);
      this._searchRenderTimer = null;
    }
    return super.close(options);
  }

  _safeRender(force = false) {
    if (this._isClosing) return;
    this.render({ force });
  }

  _resetIndexState() {
    this.page = 0;
    this.selected.clear();
    this._openFolders.clear();
    this._activeFolder = "";

    this.files = [];
    this.total = 0;

    this.loading = false;
    this._indexed = false;
    this._indexPromise = null;

    this._indexStats = { scannedDirs: 0, queuedDirs: 0, foundFiles: 0 };
    this._lastProgressRender = 0;

    this._indexRunId += 1;
    this._initialIndexScheduled = false;
    this._isClosing = false;
  }

  _getBaseDir() {
    const raw = game.settings.get(MODULE_ID, "baseDir");
    return typeof raw === "string" ? raw.trim() : "";
  }

  _scheduleInitialIndex() {
    if (this._initialIndexScheduled || this.loading || this._indexPromise || this._indexed) return;

    this._initialIndexScheduled = true;

    queueMicrotask(() => {
      if (this._isClosing) return;
      this._startIndexing();
    });
  }

  _applyIndexedFiles(files) {
    this.files = Array.isArray(files) ? files : [];
    this.total = this.files.length;
    this._indexed = true;
    this.loading = false;
    this._indexPromise = null;
    this._indexStats = {
      scannedDirs: 0,
      queuedDirs: 0,
      foundFiles: this.files.length
    };
  }

  _startIndexing() {
    if (this.loading || this._indexPromise) return;

    const baseDir = this._getBaseDir();
    const recursive = game.settings.get(MODULE_ID, "recursive");

    if (!baseDir) {
      this._applyIndexedFiles([]);
      this._safeRender(false);
      return;
    }

    const cached = getCachedIndex({ source: "data", baseDir, recursive });
    if (cached) {
      this._applyIndexedFiles(cached);
      this._safeRender(false);
      return;
    }

    const runId = ++this._indexRunId;

    this.loading = true;
    this._indexed = false;
    this.files = [];
    this.total = 0;
    this._indexStats = { scannedDirs: 0, queuedDirs: 0, foundFiles: 0 };
    this._lastProgressRender = 0;
    this._isClosing = false;

    this._safeRender(false);

    this._indexPromise = (async () => {
      try {
        const result = await indexImages({
          source: "data",
          baseDir,
          recursive,
          maxConcurrent: 4,
          browseTimeoutMs: 15000,
          onBatch: (newFiles) => {
            if (runId !== this._indexRunId || this._isClosing) return;
            if (newFiles?.length) this.files.push(...newFiles);
          },
          onProgress: (progress) => {
            if (runId !== this._indexRunId || this._isClosing) return;

            this._indexStats = progress;

            const now = Date.now();
            if (now - this._lastProgressRender > 250) {
              this._lastProgressRender = now;
              this._safeRender(false);
            }
          }
        });

        if (runId !== this._indexRunId || this._isClosing) return;
        this._applyIndexedFiles(result);
      } catch (error) {
        if (runId !== this._indexRunId || this._isClosing) return;

        console.warn(`${MODULE_ID} | Indexing failed`, error);
        this._applyIndexedFiles([]);
      } finally {
        if (runId !== this._indexRunId) return;

        this.loading = false;
        this._indexPromise = null;

        if (!this._isClosing) this._safeRender(false);
      }
    })();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return foundry.utils.mergeObject(context, this.getData(), { inplace: false });
  }

  _formatSceneNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";

    return number.toLocaleString(undefined, {
      maximumFractionDigits: Number.isInteger(number) ? 0 : 2
    });
  }

  _getShareMediaFlag(tile, key) {
    if (typeof tile?.getFlag === "function") {
      return tile.getFlag("share-media", key);
    }

    return tile?.flags?.["share-media"]?.[key];
  }

  _getSelectedScene() {
    return game.scenes?.viewed
      ?? game.scenes?.current
      ?? game.canvas?.scene
      ?? globalThis.canvas?.scene
      ?? game.scenes?.active
      ?? null;
  }

  _getVisibleSceneBounds(scene) {
    const dimensions = scene?.dimensions ?? scene?.getDimensions?.() ?? {};
    return {
      x: Number(dimensions.sceneX ?? 0),
      y: Number(dimensions.sceneY ?? 0),
      width: Number(dimensions.sceneWidth ?? scene?.width ?? 0),
      height: Number(dimensions.sceneHeight ?? scene?.height ?? 0)
    };
  }

  _prepareSceneData() {
    const scene = this._getSelectedScene();

    if (!scene) {
      return {
        available: false,
        name: "No selected scene",
        boundingTiles: [],
        boundingTileCount: 0,
        shareMediaActive: !!game.modules.get("share-media")?.active
      };
    }

    const tiles = Array.from(scene.tiles ?? []);
    const visibleBounds = this._getVisibleSceneBounds(scene);
    const boundingTiles = tiles
      .filter((tile) => {
        const enabled = this._getShareMediaFlag(tile, "enabled");
        const legacyBounding = this._getShareMediaFlag(tile, "isBounding");
        return enabled === true || enabled === 1 || enabled === "true"
          || legacyBounding === true || legacyBounding === 1 || legacyBounding === "true";
      })
      .map((tile, index) => ({
        id: tile.id,
        name: this._getShareMediaFlag(tile, "name") || `Bounding tile ${index + 1}`,
        x: this._formatSceneNumber(tile.x),
        y: this._formatSceneNumber(tile.y),
        width: this._formatSceneNumber(tile.width),
        height: this._formatSceneNumber(tile.height),
        rotation: this._formatSceneNumber(tile.rotation ?? 0),
        fitsVisibleArea: Number(tile.x) >= visibleBounds.x
          && Number(tile.y) >= visibleBounds.y
          && (Number(tile.x) + Math.abs(Number(tile.width))) <= (visibleBounds.x + visibleBounds.width)
          && (Number(tile.y) + Math.abs(Number(tile.height))) <= (visibleBounds.y + visibleBounds.height)
      }));

    const gridSize = scene.grid?.size ?? scene.dimensions?.size;
    const numericGridSize = Number(gridSize) || 100;
    const gridSizeMax = Math.max(500, Math.ceil(numericGridSize / 25) * 25);

    return {
      available: true,
      id: scene.id,
      name: scene.name || "Untitled scene",
      gridSize: this._formatSceneNumber(gridSize),
      gridSizeValue: numericGridSize,
      gridSizeMin: 50,
      gridSizeMax,
      gridSizeStep: 25,
      canEdit: scene.isOwner ?? !!game.user?.isGM,
      width: this._formatSceneNumber(scene.width ?? scene.dimensions?.sceneWidth),
      height: this._formatSceneNumber(scene.height ?? scene.dimensions?.sceneHeight),
      visibleBounds: {
        x: this._formatSceneNumber(visibleBounds.x),
        y: this._formatSceneNumber(visibleBounds.y),
        width: this._formatSceneNumber(visibleBounds.width),
        height: this._formatSceneNumber(visibleBounds.height)
      },
      boundingTiles,
      boundingTileCount: boundingTiles.length,
      shareMediaActive: !!game.modules.get("share-media")?.active
    };
  }

  _toServedUrl(path) {
    const raw = String(path);
    let decoded = raw;

    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    const routed = foundry.utils.getRoute(decoded);
    return (typeof foundry.utils.encodeURL === "function")
      ? foundry.utils.encodeURL(routed)
      : encodeURI(routed);
  }

  _normalizeBaseDir(baseDir) {
    let normalized = String(baseDir || "").trim();
    if (normalized && !normalized.endsWith("/")) normalized += "/";
    return normalized;
  }

  _splitFolderParts(folderRel) {
    const rel = String(folderRel || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!rel) return [];
    return rel.split("/").filter(Boolean);
  }

  _rootLabel(baseDir) {
    const normalized = String(baseDir || "").replace(/\/+$/, "");
    const last = normalized.split("/").filter(Boolean).pop();
    return last || normalized || "(root)";
  }

  _buildTree(visibleFileObjs, baseDir) {
    const base = this._normalizeBaseDir(baseDir);

    const root = {
      key: base || "",
      label: this._rootLabel(base),
      fullPath: base || "",
      depth: 0,
      open: true,
      selected: false,
      pinned: false,
      fileCount: 0,
      totalCount: 0,
      files: [],
      children: []
    };

    const nodeMap = new Map();
    nodeMap.set(root.fullPath, root);

    const ensureNode = (parentNode, folderName) => {
      const parentPath = parentNode.fullPath;
      const fullPath = parentPath ? `${parentPath}${folderName}/` : `${folderName}/`;

      if (nodeMap.has(fullPath)) return nodeMap.get(fullPath);

      const node = {
        key: fullPath,
        label: folderName,
        fullPath,
        depth: parentNode.depth + 1,
        open: this._openFolders.has(fullPath),
        selected: false,
        pinned: this._pinnedFolders.has(fullPath),
        fileCount: 0,
        totalCount: 0,
        files: [],
        children: []
      };

      nodeMap.set(fullPath, node);
      parentNode.children.push(node);
      return node;
    };

    for (const file of visibleFileObjs) {
      const folderAbs = String(file.folder || "");
      let folderRel = folderAbs;

      if (base && folderAbs.startsWith(base)) folderRel = folderAbs.slice(base.length);

      const parts = this._splitFolderParts(folderRel);
      let current = root;

      for (const part of parts) current = ensureNode(current, part);
      current.files.push(file);
    }

    const sortNode = (node) => {
      node.children.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
      });
      node.files.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
      node.fileCount = node.files.length;
      node.totalCount = node.fileCount;
      node.children.forEach((child) => {
        sortNode(child);
        node.totalCount += child.totalCount;
      });
    };

    sortNode(root);

    if (!this._activeFolder || !nodeMap.has(this._activeFolder)) {
      this._activeFolder = root.fullPath;
    }

    const activeNode = nodeMap.get(this._activeFolder) ?? root;
    activeNode.selected = true;

    return root;
  }

  _getFileObjects() {
    return (this.files || []).map((path) => {
      const label = String(path).split("/").pop() || String(path);
      const url = this._toServedUrl(path);
      const fullPath = String(path);
      const lastSlash = fullPath.lastIndexOf("/");
      const folder = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "";

      return { path, url, label, folder };
    });
  }

  _getVisibleFiles(fileObjs, baseDir) {
    const pageSize = game.settings.get(MODULE_ID, "pageSize");
    const rootPath = this._normalizeBaseDir(baseDir);
    const query = (this.filter || "").trim().toLowerCase();
    const inActiveFolder = fileObjs.filter((file) => {
      if (!this._activeFolder || this._activeFolder === rootPath) return true;
      return file.folder === this._activeFolder;
    });
    const filtered = inActiveFolder.filter((file) => {
      if (!query) return true;
      return file.path.toLowerCase().includes(query)
        || file.label.toLowerCase().includes(query)
        || file.folder.toLowerCase().includes(query);
    });

    const end = (this.page + 1) * pageSize;
    const visible = filtered.slice(0, end);

    return { fileObjs, filtered, visible };
  }

  getData() {
    const baseDir = game.settings.get(MODULE_ID, "baseDir");
    const recursive = game.settings.get(MODULE_ID, "recursive");
    const fileObjs = this._getFileObjects();
    const tree = this._buildTree(fileObjs, baseDir);
    const { filtered, visible } = this._getVisibleFiles(fileObjs, baseDir);
    const activeNode = this._findTreeNode(tree, this._activeFolder) ?? tree;
    const pinnedFolders = Array.from(this._pinnedFolders)
      .map((fullPath) => this._findTreeNode(tree, fullPath))
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    const selectedMap = {};
    for (const path of this.selected) selectedMap[path] = true;

    const selectedPath = this.selected.size ? Array.from(this.selected)[0] : "";

    return {
      baseDir,
      recursive,
      filter: this.filter,
      totalIndexed: this.total,
      totalFiltered: filtered.length,
      showing: visible.length,
      canLoadMore: visible.length < filtered.length,
      isIndexing: !!this.loading,
      isUploading: !!this._isUploading,
      indexStats: this._indexStats,
      tree,
      pinnedFolders,
      visibleFiles: visible,
      activeFolderLabel: activeNode === tree ? "All media" : activeNode.label,
      activeFolderPath: activeNode === tree
        ? (this._normalizeBaseDir(baseDir)
          ? `${this._normalizeBaseDir(baseDir)} (including subfolders)`
          : "Choose a folder to begin")
        : activeNode.fullPath,
      sceneData: this._prepareSceneData(),
      singleFiltered: filtered.length === 1,
      selectedCount: this.selected.size,
      selectedMap,
      selectedPath
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const root = this.element;
    root.querySelector("[data-role='toggle-recursive']")
      ?.addEventListener("change", (event) => this._toggleRecursive(event));
    root.querySelector("[data-role='search']")
      ?.addEventListener("input", (event) => this._onSearchInput(event));
    const gridSizeSlider = root.querySelector("[data-role='grid-size']");
    const gridSizeOutput = root.querySelector("[data-role='grid-size-value']");
    gridSizeSlider?.addEventListener("input", (event) => {
      if (gridSizeOutput) gridSizeOutput.textContent = event.currentTarget.value;
    });
    gridSizeSlider?.addEventListener("change", (event) => this._updateGridSize(event));

    root.querySelectorAll(".mg-thumb").forEach((thumb) => {
      thumb.addEventListener("click", (event) => this._onThumbClick(event));
      thumb.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this._onThumbClick(event);
      });
    });

    root.querySelectorAll(".mg-thumb img").forEach((image) => image.addEventListener("error", (event) => {
      const img = event.currentTarget;
      const thumb = img.closest(".mg-thumb");
      if (thumb) thumb.classList.add("is-missing");
      img.style.display = "none";
    }));

    if (!this._initialIndexScheduled && !this._indexed && !this.loading && !this._indexPromise) {
      this._scheduleInitialIndex();
    }

    if (this._restoreSearchFocus) {
      this._restoreSearchFocus = false;
      const search = root.querySelector("[data-role='search']");
      if (search) {
        search.focus();
        const end = search.value.length;
        search.setSelectionRange(end, end);
      }
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    const rerenderSceneData = () => this._safeRender(false);
    const sceneHooks = [
      "canvasReady",
      "updateScene",
      "createTile",
      "updateTile",
      "deleteTile"
    ];

    for (const hookName of sceneHooks) {
      const hookId = Hooks.on(hookName, rerenderSceneData);
      this._sceneHookIds.push([hookName, hookId]);
    }
  }

  _onClose(options) {
    for (const [hookName, hookId] of this._sceneHookIds) {
      Hooks.off(hookName, hookId);
    }
    this._sceneHookIds = [];

    super._onClose(options);
  }

  _findTreeNode(node, fullPath) {
    if (!node) return null;
    if (node.fullPath === fullPath) return node;

    for (const child of node.children || []) {
      const match = this._findTreeNode(child, fullPath);
      if (match) return match;
    }

    return null;
  }

  _openFolderAncestors(fullPath) {
    const base = this._normalizeBaseDir(this._getBaseDir());
    let relative = String(fullPath || "");
    if (base && relative.startsWith(base)) relative = relative.slice(base.length);

    const parts = this._splitFolderParts(relative);
    let current = base;

    for (const part of parts.slice(0, -1)) {
      current = `${current}${part}/`;
      this._openFolders.add(current);
    }
  }

  _selectFolder(event, target = event.currentTarget) {
    const folder = target?.dataset?.folder;
    if (folder === undefined) return;

    this._activeFolder = folder;
    this._openFolderAncestors(folder);
    this.page = 0;
    this.selected.clear();
    this._safeRender(false);
  }

  _toggleFolder(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const folder = target?.dataset?.folder;
    if (!folder) return;

    if (this._openFolders.has(folder)) this._openFolders.delete(folder);
    else this._openFolders.add(folder);

    this._safeRender(false);
  }

  async _togglePinnedFolder(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const folder = target?.dataset?.folder;
    if (!folder) return;

    const nextPins = new Set(this._pinnedFolders);
    if (nextPins.has(folder)) nextPins.delete(folder);
    else nextPins.add(folder);

    try {
      await game.settings.set(MODULE_ID, "pinnedFolders", Array.from(nextPins));
      this._pinnedFolders = nextPins;
      this._safeRender(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not save pinned folders`, error);
      ui.notifications.error("Could not update pinned folders.");
    }
  }

  _onSearchInput(event) {
    this.filter = event.currentTarget?.value ?? "";
    this.page = 0;
    this._restoreSearchFocus = true;

    if (this._searchRenderTimer) clearTimeout(this._searchRenderTimer);
    this._searchRenderTimer = setTimeout(() => {
      this._searchRenderTimer = null;
      this._safeRender(false);
    }, 140);
  }

  async _updateGridSize(event) {
    const scene = this._getSelectedScene();
    const input = event.currentTarget;
    if (!scene || !input) return;

    const requested = Number(input.value);
    if (!Number.isFinite(requested)) return;

    const gridSize = Math.max(50, Math.round(requested / 25) * 25);
    input.disabled = true;

    try {
      await scene.update({ "grid.size": gridSize });
      ui.notifications.info(`Grid size updated to ${gridSize}px.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not update Scene grid size`, error);
      ui.notifications.error("Could not update the Scene grid size.");
      input.disabled = false;
    }
  }

  async _fitBoundingTileToScene(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const scene = this._getSelectedScene();
    const tileId = target?.dataset?.tileId;
    if (!scene || !tileId) return;

    const tile = scene.tiles?.get?.(tileId)
      ?? Array.from(scene.tiles ?? []).find((candidate) => candidate.id === tileId);
    if (!tile) {
      ui.notifications.warn("The Share Media bounding tile could not be found.");
      return;
    }

    const bounds = this._getVisibleSceneBounds(scene);
    target.disabled = true;

    try {
      await tile.update({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        rotation: 0
      });
      ui.notifications.info(`Fitted ${this._getShareMediaFlag(tile, "name") || "bounding tile"} to the visible Scene.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not fit Share Media bounding tile`, error);
      ui.notifications.error("Could not fit the bounding tile to the visible Scene.");
      target.disabled = false;
    }
  }

  _clearSearch() {
    if (this._searchRenderTimer) {
      clearTimeout(this._searchRenderTimer);
      this._searchRenderTimer = null;
    }

    this.filter = "";
    this.page = 0;
    this._restoreSearchFocus = true;
    this._safeRender(false);
  }

  async _shareFile(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const path = target?.dataset?.path;
    if (!path) {
      ui.notifications.warn("No image path found.");
      return;
    }

    await openShareMediaPopout(path);
  }

  async _pickFolder() {
    const current = this._getBaseDir();

    const fp = new FilePicker({
      type: "folder",
      current,
      callback: async (path) => {
        const nextPath = typeof path === "string" ? path.trim() : "";
        if (!nextPath) return;

        await game.settings.set(MODULE_ID, "baseDir", nextPath);
        clearIndexCache();
        this._resetIndexState();
        this._safeRender(false);
      }
    });

    fp.browse(current);
  }

  async _uploadOneFile(baseDir, file) {
    try {
      await FilePicker.upload("data", baseDir, file, {}, { notify: false });
      return;
    } catch (error) {
      try {
        await FilePicker.upload("data", baseDir, file, { notify: false });
        return;
      } catch (fallbackError) {
        throw fallbackError ?? error;
      }
    }
  }

  async _refreshGallery() {
    if (this.loading || this._isUploading) return;

    clearIndexCache();
    this._resetIndexState();
    this._safeRender(false);
  }

  async _addImage() {
    if (this._isUploading) return;

    const baseDir = this._getBaseDir();
    if (!baseDir) {
      ui.notifications.warn("Pick a folder first.");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;

    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;

      this._isUploading = true;
      ui.notifications.info(`Uploading ${files.length} image${files.length === 1 ? "" : "s"} to ${baseDir}`);
      this._safeRender(false);

      let uploaded = 0;

      try {
        for (const file of files) {
          await this._uploadOneFile(baseDir, file);
          uploaded += 1;
        }

        ui.notifications.info(`Uploaded ${uploaded} image${uploaded === 1 ? "" : "s"}.`);
        clearIndexCache();
        this._resetIndexState();
        this._safeRender(false);
      } catch (error) {
        console.error(`${MODULE_ID} | Upload failed`, error);
        ui.notifications.error(`Image upload failed: ${error?.message ?? error}`);
      } finally {
        this._isUploading = false;
        this._safeRender(false);
      }
    }, { once: true });

    input.click();
  }

  async _toggleRecursive(event) {
    const value = !!event.currentTarget.checked;
    await game.settings.set(MODULE_ID, "recursive", value);

    clearIndexCache();
    this._resetIndexState();
    this._safeRender(false);
  }

  _loadMore() {
    this.page += 1;
    this._safeRender(false);
  }

  _onThumbClick(event) {
    if (event.target?.closest?.("[data-action]")) return;

    const element = event.currentTarget;
    const path = element?.dataset?.path;
    if (!path) return;

    if (this.selected.has(path)) {
      this.selected.clear();
    } else {
      this.selected.clear();
      this.selected.add(path);
    }

    this._safeRender(false);
  }
}
