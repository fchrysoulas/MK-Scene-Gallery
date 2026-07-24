import {
  DEFAULT_GRID_SIZE_MAX,
  DEFAULT_IMAGE_TITLE_FONT_SIZE,
  MODULE_ID
} from "./settings.js";
import { indexImages, getCachedIndex, clearIndexCache } from "./fileIndex.js";
import {
  displayImageOnTokenLayer,
  getTokenLayerImage,
  removeImageFromTokenLayer
} from "./tokenLayer.js";
import {
  applyScenePreset,
  captureScenePreset,
  hasScenePresetValues,
  KEEP_CURRENT,
  normalizeScenePreset,
  prepareScenePresetForm,
  readScenePresetForm
} from "./scenePresets.js";

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
      "fix-bounds": async function (event, target) {
        await this._fixSceneBounds(event, target);
      },
      "clear-search": async function () {
        this._clearSearch();
      },
      "close-image-inspector": async function (event) {
        this._closeImageInspector(event);
      },
      "copy-scene-preset": async function (event, target) {
        this._copyCurrentScenePreset(event, target);
      },
      "add-to-token-layer": async function (event, target) {
        await this._addToTokenLayer(event, target);
      },
      "remove-token-layer-image": async function (event, target) {
        await this._removeTokenLayerImage(event, target);
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

  _resetIndexState({ activeFolder = "" } = {}) {
    this.page = 0;
    this.selected.clear();
    this._openFolders.clear();
    this._activeFolder = activeFolder;
    if (activeFolder) this._openFolderAncestors(activeFolder);

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

  _getSelectedScene() {
    return game.scenes?.viewed
      ?? game.scenes?.current
      ?? game.canvas?.scene
      ?? globalThis.canvas?.scene
      ?? game.scenes?.active
      ?? null;
  }

  _getGridSizeMax() {
    const configured = Number(game.settings.get(MODULE_ID, "gridSizeMax"));
    if (!Number.isFinite(configured) || configured < 50) return DEFAULT_GRID_SIZE_MAX;
    return Math.max(50, Math.round(configured / 25) * 25);
  }

  _getImageTitleFontSize() {
    const configured = Number(game.settings.get(MODULE_ID, "imageTitleFontSize"));
    if (!Number.isFinite(configured)) return DEFAULT_IMAGE_TITLE_FONT_SIZE;
    return Math.min(24, Math.max(8, Math.round(configured)));
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

  _getLockViewBoundingMode(drawing) {
    const flags = drawing?.flags?.LockView ?? drawing?.flags?.lockview;
    const mode = flags?.boundingBox;
    if (mode === "always" || mode === "owned") return mode;

    const legacyMode = Number(flags?.boundingBox_mode);
    if (legacyMode === 2) return "always";
    if (legacyMode === 1) return "owned";
    return null;
  }

  _getLockViewBoundingDrawing(scene) {
    const drawings = Array.from(scene?.drawings ?? [])
      .filter((drawing) => drawing?.shape?.type === "r" && this._getLockViewBoundingMode(drawing));

    return drawings.find((drawing) => this._getLockViewBoundingMode(drawing) === "always")
      ?? drawings[0]
      ?? null;
  }

  _getDrawingAnchor(scene, drawing) {
    const bounds = this._getVisibleSceneBounds(scene);
    const width = Math.abs(Number(drawing?.shape?.width ?? drawing?.width ?? 0));
    const height = Math.abs(Number(drawing?.shape?.height ?? drawing?.height ?? 0));
    const x = Number(drawing?.x ?? 0);
    const y = Number(drawing?.y ?? 0);
    const positions = {
      "top-left": { x: bounds.x, y: bounds.y },
      "top-right": { x: bounds.x + bounds.width - width, y: bounds.y },
      "bottom-left": { x: bounds.x, y: bounds.y + bounds.height - height },
      "bottom-right": {
        x: bounds.x + bounds.width - width,
        y: bounds.y + bounds.height - height
      }
    };

    return Object.entries(positions).reduce((closest, [value, position]) => {
      const distance = ((x - position.x) ** 2) + ((y - position.y) ** 2);
      return distance < closest.distance ? { value, distance } : closest;
    }, { value: "top-left", distance: Number.POSITIVE_INFINITY }).value;
  }

  _prepareSceneData() {
    const scene = this._getSelectedScene();
    const gridSizeMax = this._getGridSizeMax();

    if (!scene) {
      return {
        available: false,
        name: "No selected scene",
        gridSize: "—",
        gridSizeValue: 50,
        gridSizeMin: 50,
        gridSizeMax,
        gridSizeStep: 25,
        gridDisabled: true,
        gridTitle: "Select or view a scene to change its grid size",
        tokenLayerRemoveDisabled: true,
        tokenLayerRemoveTitle: "Open a scene before removing its Token Layer image",
        fixDisabled: true,
        fixTitle: "Select or view a scene to fix its bounds",
        lockViewBounds: { available: false }
      };
    }

    const gridSize = scene.grid?.size ?? scene.dimensions?.size;
    const numericGridSize = Number(gridSize) || 100;
    const gridSizeValue = Math.min(gridSizeMax, Math.max(50, numericGridSize));
    const canEdit = scene.isOwner ?? !!game.user?.isGM;
    const tokenLayerImage = getTokenLayerImage(scene);
    const lockViewDrawing = this._getLockViewBoundingDrawing(scene);
    const drawingAnchor = lockViewDrawing
      ? this._getDrawingAnchor(scene, lockViewDrawing)
      : "top-left";
    const anchorOptions = [
      { value: "top-left", label: "Top Left" },
      { value: "top-right", label: "Top Right" },
      { value: "bottom-left", label: "Bottom Left" },
      { value: "bottom-right", label: "Bottom Right" }
    ].map((option) => ({ ...option, selected: option.value === drawingAnchor }));

    return {
      available: true,
      id: scene.id,
      name: scene.name || "Untitled scene",
      gridSize: this._formatSceneNumber(gridSize),
      gridSizeValue,
      gridSizeMin: 50,
      gridSizeMax,
      gridSizeStep: 25,
      gridDisabled: !canEdit,
      gridTitle: canEdit
        ? `Change ${scene.name || "selected Scene"} grid size`
        : `You cannot edit ${scene.name || "the selected Scene"}`,
      tokenLayerRemoveDisabled: !canEdit || !tokenLayerImage?.path,
      tokenLayerRemoveTitle: !canEdit
        ? `You cannot edit ${scene.name || "the selected Scene"}`
        : tokenLayerImage?.path
          ? `Remove ${tokenLayerImage.name || "the current image"} from the Token Layer`
          : "The active scene has no Token Layer image",
      fixDisabled: !canEdit || !lockViewDrawing,
      fixTitle: !canEdit
        ? `You cannot edit ${scene.name || "the selected Scene"}`
        : lockViewDrawing
          ? "Anchor the Lock View Bounding Box to the selected Scene"
          : "No Lock View Bounding Box was found on the selected Scene",
      lockViewBounds: {
        available: !!lockViewDrawing,
        drawingId: lockViewDrawing?.id ?? "",
        disabled: !canEdit,
        options: anchorOptions,
        title: canEdit
          ? "Anchor the Lock View bounding drawing to a corner of the visible Scene"
          : `You cannot edit ${scene.name || "the selected Scene"}`
      }
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

    if (!this._activeFolder || (this._indexed && !nodeMap.has(this._activeFolder))) {
      this._activeFolder = root.fullPath;
    }

    const activeNode = nodeMap.get(this._activeFolder) ?? root;
    activeNode.selected = true;

    return root;
  }

  _getFileObjects() {
    const savedTitles = game.settings.get(MODULE_ID, "imageTitles");
    const imageTitles = savedTitles && typeof savedTitles === "object" && !Array.isArray(savedTitles)
      ? savedTitles
      : {};
    const savedMetadata = game.settings.get(MODULE_ID, "imageMetadata");
    const imageMetadata = savedMetadata
      && typeof savedMetadata === "object"
      && !Array.isArray(savedMetadata)
      ? savedMetadata
      : {};

    return (this.files || []).map((path) => {
      const fileName = String(path).split("/").pop() || String(path);
      const metadata = imageMetadata[path]
        && typeof imageMetadata[path] === "object"
        && !Array.isArray(imageMetadata[path])
        ? imageMetadata[path]
        : {};
      const hasMetadataTitle = Object.prototype.hasOwnProperty.call(metadata, "title");
      const customTitle = hasMetadataTitle
        ? String(metadata.title || "").trim()
        : typeof imageTitles[path] === "string"
          ? imageTitles[path].trim()
          : "";
      const description = typeof metadata.description === "string"
        ? metadata.description.trim()
        : "";
      const rawScenePreset = metadata.scenePreset
        && typeof metadata.scenePreset === "object"
        && !Array.isArray(metadata.scenePreset)
        ? { ...metadata.scenePreset }
        : {};
      if (
        (rawScenePreset.gridSize === null || rawScenePreset.gridSize === undefined)
        && metadata.gridSize !== null
        && metadata.gridSize !== undefined
      ) {
        rawScenePreset.gridSize = metadata.gridSize;
      }
      const scenePreset = normalizeScenePreset(rawScenePreset, {
        gridSizeMax: this._getGridSizeMax()
      });
      const gridSize = scenePreset.gridSize ?? "";
      const label = customTitle || fileName;
      const url = this._toServedUrl(path);
      const fullPath = String(path);
      const lastSlash = fullPath.lastIndexOf("/");
      const folder = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "";

      return {
        path,
        url,
        label,
        fileName,
        customTitle,
        description,
        gridSize,
        scenePreset,
        folder,
      };
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
        || file.description.toLowerCase().includes(query)
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
    const selectedImage = selectedPath
      ? fileObjs.find((file) => file.path === selectedPath) ?? null
      : null;
    if (selectedImage) {
      selectedImage.scenePresetForm = prepareScenePresetForm(selectedImage.scenePreset, {
        gridSizeMax: this._getGridSizeMax()
      });
    }

    return {
      baseDir,
      recursive,
      imageTitleFontSize: this._getImageTitleFontSize(),
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
      selectedPath,
      selectedImage,
      imageGridSizeMin: 50,
      imageGridSizeMax: this._getGridSizeMax(),
      imageGridSizeStep: 25,
      selectedSceneAvailable: !!this._getSelectedScene()
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
    root.querySelector("[data-role='lockview-anchor']")
      ?.addEventListener("change", (event) => this._anchorLockViewBounds(event));

    root.querySelectorAll(".mg-thumb").forEach((thumb) => {
      thumb.addEventListener("click", (event) => this._onThumbClick(event));
      thumb.addEventListener("contextmenu", (event) => this._openImagePreview(event));
      thumb.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this._onThumbClick(event);
      });
    });

    root.querySelector("[data-role='image-details-form']")
      ?.addEventListener("submit", (event) => this._saveImageDetails(event));

    const previewDialog = root.querySelector("[data-role='image-preview']");
    previewDialog?.querySelector("[data-role='image-preview-close']")
      ?.addEventListener("click", () => this._closeImagePreview(previewDialog));
    previewDialog?.addEventListener("click", (event) => {
      if (event.target === previewDialog) this._closeImagePreview(previewDialog);
    });
    previewDialog?.addEventListener("close", () => {
      previewDialog.querySelector("[data-role='image-preview-image']")?.removeAttribute("src");
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
      "deleteTile",
      "createDrawing",
      "updateDrawing",
      "deleteDrawing"
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

    input.disabled = true;
    try {
      await this._applySceneGridSize(scene, input.value, { notifyOnSuccess: true });
    } finally {
      input.disabled = false;
    }
  }

  async _applySceneGridSize(scene, requested, { notifyOnSuccess = false } = {}) {
    const requestedNumber = Number(requested);
    if (!scene || !Number.isFinite(requestedNumber)) return false;

    if (!(scene.isOwner ?? !!game.user?.isGM)) {
      ui.notifications.error(`You cannot edit ${scene.name || "the selected Scene"}.`);
      return false;
    }

    const normalized = normalizeScenePreset(
      { gridSize: requestedNumber },
      { gridSizeMax: this._getGridSizeMax() }
    );
    if (normalized.gridSize === Number(scene.grid?.size ?? scene.dimensions?.size)) {
      return true;
    }

    try {
      const result = await applyScenePreset(
        scene,
        normalized,
        { gridSizeMax: this._getGridSizeMax() }
      );
      if (notifyOnSuccess) {
        ui.notifications.info(
          `Grid size changed to ${result.preset.gridSize} px. Ambient Light positions and pixel coverage were preserved.`
        );
      }
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Could not update Scene grid size`, error);
      ui.notifications.error("Could not update the Scene grid size and Ambient Light radii.");
      return false;
    }
  }

  async _anchorLockViewBounds(event, trigger = event.currentTarget) {
    const scene = this._getSelectedScene();
    const select = event.currentTarget;
    const drawingId = select?.dataset?.drawingId;
    const anchor = select?.value;
    if (!scene || !drawingId || !anchor) return;

    const drawing = scene.drawings?.get?.(drawingId)
      ?? Array.from(scene.drawings ?? []).find((candidate) => candidate.id === drawingId);
    if (!drawing || !this._getLockViewBoundingMode(drawing)) {
      ui.notifications.warn("The Lock View Bounding Box drawing could not be found.");
      return;
    }

    const bounds = this._getVisibleSceneBounds(scene);
    const width = Math.abs(Number(drawing.shape?.width ?? drawing.width ?? 0));
    const height = Math.abs(Number(drawing.shape?.height ?? drawing.height ?? 0));
    const positions = {
      "top-left": { x: bounds.x, y: bounds.y },
      "top-right": { x: bounds.x + bounds.width - width, y: bounds.y },
      "bottom-left": { x: bounds.x, y: bounds.y + bounds.height - height },
      "bottom-right": {
        x: bounds.x + bounds.width - width,
        y: bounds.y + bounds.height - height
      }
    };
    const position = positions[anchor];
    if (!position) return;

    select.disabled = true;
    if (trigger && trigger !== select) trigger.disabled = true;

    try {
      await drawing.update(position);
      const label = select.options?.[select.selectedIndex]?.textContent?.trim() || anchor;
      ui.notifications.info(`Bounding Box anchored to ${label}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not anchor Lock View bounding drawing`, error);
      ui.notifications.error("Could not anchor the Lock View Bounding Box.");
    } finally {
      select.disabled = false;
      if (trigger && trigger !== select) trigger.disabled = false;
    }
  }

  async _fixSceneBounds(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const scene = this._getSelectedScene();
    if (!scene || !target) return;

    const bounds = this._getVisibleSceneBounds(scene);
    const operations = [];

    const select = this.element?.querySelector?.("[data-role='lockview-anchor']");
    const drawingId = select?.dataset?.drawingId;
    const anchor = select?.value;
    if (drawingId && anchor) {
      const drawing = scene.drawings?.get?.(drawingId)
        ?? Array.from(scene.drawings ?? []).find((candidate) => candidate.id === drawingId);
      if (drawing && this._getLockViewBoundingMode(drawing)) {
        const width = Math.abs(Number(drawing.shape?.width ?? drawing.width ?? 0));
        const height = Math.abs(Number(drawing.shape?.height ?? drawing.height ?? 0));
        const positions = {
          "top-left": { x: bounds.x, y: bounds.y },
          "top-right": { x: bounds.x + bounds.width - width, y: bounds.y },
          "bottom-left": { x: bounds.x, y: bounds.y + bounds.height - height },
          "bottom-right": {
            x: bounds.x + bounds.width - width,
            y: bounds.y + bounds.height - height
          }
        };
        const position = positions[anchor];
        if (position) operations.push(() => drawing.update(position));
      }
    }

    if (!operations.length) {
      ui.notifications.warn("No Scene bounds were found to fix.");
      return;
    }

    target.disabled = true;
    try {
      for (const update of operations) await update();
      ui.notifications.info("Scene bounds fixed.");
    } catch (error) {
      console.error(`${MODULE_ID} | Could not fix Scene bounds`, error);
      ui.notifications.error("Could not fix the Scene bounds.");
    } finally {
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

  _closeImageInspector(event) {
    event.preventDefault();
    event.stopPropagation();

    this.selected.clear();
    this._safeRender(false);
  }

  _copyCurrentScenePreset(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const scene = this._getSelectedScene();
    const form = target?.closest?.("[data-role='image-details-form']");
    if (!scene || !form) return;

    const preset = captureScenePreset(scene, { gridSizeMax: this._getGridSizeMax() });
    const setValue = (name, value) => {
      const field = form.elements?.[name];
      if (field) field.value = value ?? "";
    };

    for (const [name, value] of Object.entries(preset)) {
      if (name === "weather") {
        setValue(name, value === null ? KEEP_CURRENT : value);
      } else {
        setValue(name, value);
      }
    }
  }

  async _saveImageDetails(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const path = form?.dataset?.path;
    if (!path) return;

    const title = String(form.elements?.title?.value ?? "").trim();
    const description = String(form.elements?.description?.value ?? "").trim();
    const scenePreset = readScenePresetForm(form, {
      gridSizeMax: this._getGridSizeMax()
    });

    const savedMetadata = game.settings.get(MODULE_ID, "imageMetadata");
    const nextMetadata = savedMetadata
      && typeof savedMetadata === "object"
      && !Array.isArray(savedMetadata)
      ? { ...savedMetadata }
      : {};
    nextMetadata[path] = {
      title,
      description,
      gridSize: scenePreset.gridSize,
      scenePreset
    };

    const submit = form.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;

    try {
      await game.settings.set(MODULE_ID, "imageMetadata", nextMetadata);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not save image details`, error);
      ui.notifications.error("Could not save the image details.");
    } finally {
      this._safeRender(false);
    }
  }

  async _addToTokenLayer(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const path = target?.dataset?.path;
    if (!path) {
      ui.notifications.warn("No image path found.");
      return;
    }

    const image = this._getFileObjects().find((candidate) => candidate.path === path);
    const scene = this._getSelectedScene();
    if (image && hasScenePresetValues(image.scenePreset)) {
      if (!scene) {
        ui.notifications.warn("Open a scene before displaying an image on its Token Layer.");
        return;
      }
      if (!(scene.isOwner ?? !!game.user?.isGM)) {
        ui.notifications.error(`You cannot edit ${scene.name || "the selected Scene"}.`);
        return;
      }

      try {
        await applyScenePreset(scene, image.scenePreset, {
          gridSizeMax: this._getGridSizeMax()
        });
      } catch (error) {
        console.error(`${MODULE_ID} | Could not apply image Scene preset`, error);
        ui.notifications.error("Could not apply the image Scene preset.");
        return;
      }
    }

    const displayed = await displayImageOnTokenLayer(
      path,
      image?.label || target?.dataset?.title
    );
    if (!displayed || !image?.scenePreset) return;

    const activeCanvas = globalThis.canvas;
    if (!activeCanvas?.ready || activeCanvas?.scene?.id !== scene?.id) return;

    const view = {};
    if (image.scenePreset.initialX !== null) view.x = image.scenePreset.initialX;
    if (image.scenePreset.initialY !== null) view.y = image.scenePreset.initialY;
    if (image.scenePreset.initialScale !== null) view.scale = image.scenePreset.initialScale;
    if (Object.keys(view).length) await activeCanvas.animatePan(view);
  }

  async _removeTokenLayerImage(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    if (target) target.disabled = true;
    try {
      await removeImageFromTokenLayer();
    } finally {
      this._safeRender(false);
    }
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
    const uploadDir = this._activeFolder || baseDir;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;

    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;

      this._isUploading = true;
      ui.notifications.info(`Uploading ${files.length} image${files.length === 1 ? "" : "s"} to ${uploadDir}`);
      this._safeRender(false);

      let uploaded = 0;
      let uploadError = null;

      try {
        for (const file of files) {
          await this._uploadOneFile(uploadDir, file);
          uploaded += 1;
        }
      } catch (error) {
        uploadError = error;
        console.error(`${MODULE_ID} | Upload failed`, error);
      } finally {
        if (uploaded > 0) {
          clearIndexCache();
          this._resetIndexState({ activeFolder: uploadDir });
        }

        this._isUploading = false;
        this._safeRender(false);
      }

      if (uploadError) {
        const progress = uploaded
          ? `Uploaded ${uploaded} of ${files.length} images before the failure. `
          : "";
        ui.notifications.error(`${progress}Image upload failed: ${uploadError?.message ?? uploadError}`);
      } else {
        ui.notifications.info(`Uploaded ${uploaded} image${uploaded === 1 ? "" : "s"}.`);
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

  _openImagePreview(event) {
    event.preventDefault();
    event.stopPropagation();

    const thumb = event.currentTarget;
    const sourceImage = thumb?.querySelector?.(".mg-img");
    const dialog = this.element?.querySelector?.("[data-role='image-preview']");
    const previewImage = dialog?.querySelector?.("[data-role='image-preview-image']");
    if (!sourceImage || !dialog || !previewImage) return;

    const path = thumb.dataset?.path || sourceImage.currentSrc || sourceImage.src;
    const label = sourceImage.alt || String(path).split("/").pop() || "Image preview";
    previewImage.src = sourceImage.currentSrc || sourceImage.src;
    previewImage.alt = label;

    const title = dialog.querySelector("[data-role='image-preview-title']");
    const pathElement = dialog.querySelector("[data-role='image-preview-path']");
    if (title) title.textContent = label;
    if (pathElement) {
      pathElement.textContent = path;
      pathElement.title = path;
    }

    if (dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  _closeImagePreview(dialog = this.element?.querySelector?.("[data-role='image-preview']")) {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      dialog.querySelector("[data-role='image-preview-image']")?.removeAttribute("src");
    }
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
