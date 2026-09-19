import {
  DEFAULT_GRID_SIZE_MAX,
  DEFAULT_IMAGE_TITLE_FONT_SIZE,
  DEFAULT_PAGE_SIZE,
  MODULE_ID
} from "./settings.js";
import { clearIndexCache, getMediaType } from "./fileIndex.js";
import {
  getSceneBackground,
  removeSceneBackground,
  setSceneBackground
} from "./sceneBackground.js";
import {
  applyScenePreset,
  captureScenePreset,
  hasScenePresetValues,
  KEEP_CURRENT,
  normalizeScenePreset,
  prepareScenePresetForm,
  readScenePresetForm
} from "./scenePresets.js";
import { GalleryIndexingMixin } from "./galleryIndexing.js";
import {
  getGalleryWindowTitle,
  getSavedWindowPosition,
  normalizeWindowPosition
} from "./galleryWindow.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MAX_RECENT_IMAGES = 30;
const EMPTY_RECORD = Object.freeze({});
const SCENE_PRESET_SECTION_FIELDS = Object.freeze({
  grid: new Set([
    "gridSize",
    "gridType",
    "gridColor",
    "gridAlpha",
    "gridDistance",
    "gridUnits"
  ]),
  "light-sources": new Set(["lightSources"]),
  vision: new Set([
    "darkness",
    "padding",
    "tokenVision",
    "fogExploration",
    "weather"
  ]),
  "initial-view": new Set(["initialX", "initialY", "initialScale"])
});

export class MediaGalleryApp extends GalleryIndexingMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: "mk-scene-gallery-app",
    classes: ["mk-scene-gallery", "mg-glass-window"],
    position: {
      width: 1100,
      height: 720
    },
    window: {
      title: getGalleryWindowTitle(),
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
      "select-folder": async function (event, target) {
        this._selectFolder(event, target);
      },
      "toggle-folder": async function (event, target) {
        this._toggleFolder(event, target);
      },
      "toggle-sidebar": async function (event, target) {
        await this._toggleSidebar(event, target);
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
      "preview-image": async function (event, target) {
        await this._openImagePreviewAction(event, target);
      },
      "select-quick-filter": async function (event, target) {
        this._selectQuickFilter(event, target);
      },
      "select-tag-filter": async function (event, target) {
        this._selectTagFilter(event, target);
      },
      "toggle-favorite": async function (event, target) {
        await this._toggleFavorite(event, target);
      },
      "set-scene-background": async function (event, target) {
        await this._setSceneBackground(event, target);
      },
      "remove-scene-background": async function (event, target) {
        await this._removeSceneBackground(event, target);
      }
    }
  };

  static PARTS = {
    gallery: {
      template: `modules/${MODULE_ID}/templates/gallery.hbs`,
      scrollable: [".mg-tree-scroll", ".mg-gallery-scroll"]
    }
  };

  constructor(options = {}) {
    const savedPosition = getSavedWindowPosition();
    const requestedPosition = options.position && typeof options.position === "object"
      ? options.position
      : {};
    const position = { ...savedPosition, ...requestedPosition };
    super(Object.keys(position).length ? { ...options, position } : options);

    this.files = [];
    this.filter = "";
    this._quickFilter = "all";
    this._tagFilter = "";
    this._sidebarCollapsed = game.settings.get(MODULE_ID, "sidebarCollapsed") === true;
    this.page = 0;

    this.loading = false;
    this._indexed = false;
    this._indexPromise = null;
    this.total = 0;

    this._indexStats = { scannedDirs: 0, queuedDirs: 0, foundFiles: 0 };

    this._openFolders = new Set();
    this._activeFolder = "";
    const savedPins = game.settings.get(MODULE_ID, "pinnedFolders");
    this._pinnedFolders = new Set(
      Array.isArray(savedPins)
        ? savedPins.filter((path) => typeof path === "string" && path.length)
        : []
    );
    const savedFavorites = game.settings.get(MODULE_ID, "favoriteImages");
    this._favoriteImages = new Set(
      Array.isArray(savedFavorites)
        ? savedFavorites.filter((path) => typeof path === "string" && path.length)
        : []
    );
    const savedRecents = game.settings.get(MODULE_ID, "recentImages");
    this._recentImages = Array.isArray(savedRecents)
      ? Array.from(new Set(
        savedRecents.filter((path) => typeof path === "string" && path.length)
      )).slice(0, MAX_RECENT_IMAGES)
      : [];
    this._searchRenderTimer = null;
    this._restoreSearchFocus = false;
    this._sceneHookIds = [];

    this._indexRunId = 0;
    this._isClosing = false;
    this._initialIndexScheduled = false;
    this._isUploading = false;
    this._selectedImagePath = "";
    this._fileObjectsCache = null;
    this._fileObjectsCacheFiles = null;
    this._fileObjectsCacheLength = -1;
    this._fileObjectsCacheTitles = null;
    this._fileObjectsCacheMetadata = null;
    this._fileObjectsCacheGridSizeMax = null;
    this._treeCache = null;
    this._availableTagsCache = null;
    this._visibleFilesCache = null;
    this._filterRevision = 0;
    this._imagePreviewApp = null;
    this._sceneDetailsApp = null;
    this._sceneRerenderTimer = null;
    this._thumbnailVideoObserver = null;
    this._galleryScrollElement = null;
    this._galleryScrollHandler = (event) => this._maybeLoadMore(event.currentTarget);
    this._galleryInteractionRoot = null;
    this._galleryInteractionHandler = (event) => this._handleGalleryInteraction(event);
    this._galleryLoadCheckTimer = null;
    this._loadMoreCompleteTimer = null;
    this._loadMorePending = false;
    this._isLoadingMore = false;
    this._canLoadMore = false;
    this._activeThumbnailVideo = null;
  }

  async close(options = {}) {
    this._isClosing = true;
    this._indexRunId += 1;
    this.loading = false;
    this._indexPromise = null;
    await this._saveWindowPosition();
    if (this._searchRenderTimer) {
      clearTimeout(this._searchRenderTimer);
      this._searchRenderTimer = null;
    }
    if (this._sceneRerenderTimer) {
      clearTimeout(this._sceneRerenderTimer);
      this._sceneRerenderTimer = null;
    }
    if (this._galleryLoadCheckTimer) {
      clearTimeout(this._galleryLoadCheckTimer);
      this._galleryLoadCheckTimer = null;
    }
    if (this._loadMoreCompleteTimer) {
      clearTimeout(this._loadMoreCompleteTimer);
      this._loadMoreCompleteTimer = null;
    }
    this._isLoadingMore = false;
    this._galleryScrollElement?.removeEventListener("scroll", this._galleryScrollHandler);
    this._galleryScrollElement = null;
    this._removeGalleryInteractionListeners();
    this._pauseActiveThumbnailVideo();
    await this._sceneDetailsApp?.close?.();
    this._thumbnailVideoObserver?.disconnect?.();
    this._thumbnailVideoObserver = null;
    return super.close(options);
  }

  async _saveWindowPosition() {
    const position = normalizeWindowPosition(this.position);
    if (!Object.keys(position).length) return;

    try {
      await game.settings.set(MODULE_ID, "windowPosition", position);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not save gallery window position`, error);
    }
  }

  _safeRender(force = false) {
    if (this._isClosing) return;
    this.render({ force });
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
        backgroundRemoveDisabled: true,
        backgroundRemoveTitle: "Open a scene before removing its background image",
        fixDisabled: true,
        fixTitle: "Select or view a scene to fix its bounds",
        lockViewBounds: { available: false }
      };
    }

    const gridSize = scene.grid?.size ?? scene.dimensions?.size;
    const numericGridSize = Number(gridSize) || 100;
    const gridSizeValue = Math.min(gridSizeMax, Math.max(50, numericGridSize));
    const canEdit = scene.isOwner ?? !!game.user?.isGM;
    const background = getSceneBackground(scene);
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
      backgroundRemoveDisabled: !canEdit || !background?.path,
      backgroundRemoveTitle: !canEdit
        ? `You cannot edit ${scene.name || "the selected Scene"}`
        : background?.path
          ? `Remove ${background.name || "the current image"} from the Scene background`
          : "The selected Scene has no background image",
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
    const raw = String(path ?? "").trim();
    if (!raw) return "";

    // Hosted services such as Forge return fully-qualified CDN URLs. These are
    // already browser-ready and must not be passed through Foundry's getRoute,
    // which would turn the URL into a local path such as /https%3A//... .
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return raw;

    let decoded = raw;

    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    const routed = foundry.utils.getRoute(decoded);
    const encoded = (typeof foundry.utils.encodeURL === "function")
      ? foundry.utils.encodeURL(routed)
      : encodeURI(routed);

    // Keep Foundry data paths rooted at the server origin so they do not
    // resolve relative to the current application route.
    return encoded.startsWith("/") ? encoded : `/${encoded}`;
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

  _invalidateFileObjectsCache() {
    this._fileObjectsCache = null;
    this._fileObjectsCacheFiles = null;
    this._fileObjectsCacheLength = -1;
    this._fileObjectsCacheTitles = null;
    this._fileObjectsCacheMetadata = null;
    this._fileObjectsCacheGridSizeMax = null;
    this._treeCache = null;
    this._availableTagsCache = null;
    this._visibleFilesCache = null;
  }

  _getPinnedFolderSignature() {
    return Array.from(this._pinnedFolders).sort().join("\u0000");
  }

  _sortTreeChildren(node) {
    node.children.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    node.children.forEach((child) => this._sortTreeChildren(child));
  }

  _sortTreeNode(node) {
    node.children.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    node.files.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    node.fileCount = node.files.length;
    node.totalCount = node.fileCount;
    node.children.forEach((child) => {
      this._sortTreeNode(child);
      node.totalCount += child.totalCount;
    });
  }

  _refreshTreeNodeState(node) {
    node.open = node.depth === 0 || this._openFolders.has(node.fullPath);
    node.pinned = node.depth > 0 && this._pinnedFolders.has(node.fullPath);
    node.selected = false;
    node.children.forEach((child) => this._refreshTreeNodeState(child));
  }

  _buildTree(visibleFileObjs, baseDir) {
    const base = this._normalizeBaseDir(baseDir);
    const pinnedSignature = this._getPinnedFolderSignature();
    const cached = this._treeCache;

    if (cached?.fileObjs === visibleFileObjs && cached.base === base) {
      this._refreshTreeNodeState(cached.root);
      if (cached.pinnedSignature !== pinnedSignature) {
        this._sortTreeChildren(cached.root);
        cached.pinnedSignature = pinnedSignature;
      }

      if (!this._activeFolder || (this._indexed && !cached.nodeMap.has(this._activeFolder))) {
        this._activeFolder = cached.root.fullPath;
      }
      const activeNode = cached.nodeMap.get(this._activeFolder) ?? cached.root;
      activeNode.selected = true;
      return cached.root;
    }

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
        open: false,
        selected: false,
        pinned: false,
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

    this._refreshTreeNodeState(root);
    this._sortTreeNode(root);
    this._treeCache = {
      fileObjs: visibleFileObjs,
      base,
      pinnedSignature,
      root,
      nodeMap
    };

    if (!this._activeFolder || (this._indexed && !nodeMap.has(this._activeFolder))) {
      this._activeFolder = root.fullPath;
    }

    const activeNode = nodeMap.get(this._activeFolder) ?? root;
    activeNode.selected = true;

    return root;
  }

  _getFileObjects() {
    const files = this.files || [];
    const savedTitles = game.settings.get(MODULE_ID, "imageTitles");
    const imageTitles = savedTitles && typeof savedTitles === "object" && !Array.isArray(savedTitles)
      ? savedTitles
      : EMPTY_RECORD;
    const savedMetadata = game.settings.get(MODULE_ID, "imageMetadata");
    const imageMetadata = savedMetadata
      && typeof savedMetadata === "object"
      && !Array.isArray(savedMetadata)
      ? savedMetadata
      : EMPTY_RECORD;

    const gridSizeMax = this._getGridSizeMax();
    const cacheValid = this._fileObjectsCache
      && this._fileObjectsCacheFiles === files
      && this._fileObjectsCacheLength === files.length
      && this._fileObjectsCacheTitles === savedTitles
      && this._fileObjectsCacheMetadata === savedMetadata
      && this._fileObjectsCacheGridSizeMax === gridSizeMax;

    if (!cacheValid) {
      this._fileObjectsCache = files.map((path) => {
        const fileName = String(path).split("/").pop() || String(path);
        const metadata = imageMetadata[path]
          && typeof imageMetadata[path] === "object"
          && !Array.isArray(imageMetadata[path])
          ? imageMetadata[path]
          : EMPTY_RECORD;
        const hasMetadata = Object.prototype.hasOwnProperty.call(imageMetadata, path)
          || Object.prototype.hasOwnProperty.call(imageTitles, path);
        const hasMetadataTitle = Object.prototype.hasOwnProperty.call(metadata, "title");
        const customTitle = hasMetadataTitle
          ? String(metadata.title || "").trim()
          : typeof imageTitles[path] === "string"
            ? imageTitles[path].trim()
            : "";
        const description = typeof metadata.description === "string"
          ? metadata.description.trim()
          : "";
        const tags = this._normalizeTags(metadata.tags);
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
          gridSizeMax
        });
        const gridSize = scenePreset.gridSize ?? "";
        const label = customTitle || fileName;
        const url = this._toServedUrl(path);
        const fullPath = String(path);
        const lastSlash = fullPath.lastIndexOf("/");
        const folder = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "";
        const isVideo = getMediaType(fileName) === "video";

        return {
          path,
          url,
          isVideo,
          label,
          fileName,
          customTitle,
          description,
          tags,
          tagsText: tags.join(", "),
          displayTags: tags.slice(0, 3),
          extraTagCount: Math.max(0, tags.length - 3),
          gridSize,
          scenePreset,
          hasMetadata,
          hasScenePreset: hasScenePresetValues(scenePreset),
          favorite: false,
          recentlyDisplayed: false,
          selected: false,
          folder,
        };
      });
      this._fileObjectsCacheFiles = files;
      this._fileObjectsCacheLength = files.length;
      this._fileObjectsCacheTitles = savedTitles;
      this._fileObjectsCacheMetadata = savedMetadata;
      this._fileObjectsCacheGridSizeMax = gridSizeMax;
      this._treeCache = null;
      this._availableTagsCache = null;
    }

    const recentImages = new Set(this._recentImages);
    for (const file of this._fileObjectsCache) {
      file.favorite = this._favoriteImages.has(file.path);
      file.recentlyDisplayed = recentImages.has(file.path);
      file.selected = file.path === this._selectedImagePath;
    }

    return this._fileObjectsCache;
  }

  _getVisibleFiles(fileObjs, baseDir) {
    const configuredPageSize = Number(game.settings.get(MODULE_ID, "pageSize"));
    const normalizedPageSize = Math.floor(configuredPageSize);
    const pageSize = Number.isFinite(normalizedPageSize) && normalizedPageSize > 0
      ? Math.min(DEFAULT_PAGE_SIZE, normalizedPageSize)
      : DEFAULT_PAGE_SIZE;
    const rootPath = this._normalizeBaseDir(baseDir);
    const query = (this.filter || "").trim().toLowerCase();
    const cached = this._visibleFilesCache;
    if (
      cached?.fileObjs === fileObjs
      && cached.baseDir === rootPath
      && cached.activeFolder === this._activeFolder
      && cached.quickFilter === this._quickFilter
      && cached.tagFilter === this._tagFilter
      && cached.query === query
      && cached.page === this.page
      && cached.filterRevision === this._filterRevision
    ) return cached.result;

    let candidates;

    if (this._quickFilter === "favorites") {
      candidates = fileObjs.filter((file) => file.favorite);
    } else if (this._quickFilter === "recent") {
      const recentOrder = new Map(this._recentImages.map((path, index) => [path, index]));
      candidates = fileObjs
        .filter((file) => recentOrder.has(file.path))
        .sort((a, b) => recentOrder.get(a.path) - recentOrder.get(b.path));
    } else if (this._tagFilter) {
      candidates = fileObjs;
    } else {
      candidates = fileObjs.filter((file) => {
        if (!this._activeFolder || this._activeFolder === rootPath) return true;
        return file.folder === this._activeFolder;
      });
    }

    if (this._tagFilter) {
      candidates = candidates.filter((file) => file.tags.includes(this._tagFilter));
    }

    const filtered = candidates.filter((file) => {
      if (!query) return true;
      return file.path.toLowerCase().includes(query)
        || file.label.toLowerCase().includes(query)
        || file.description.toLowerCase().includes(query)
        || file.tags.some((tag) => tag.includes(query))
        || file.folder.toLowerCase().includes(query);
    });

    const end = (this.page + 1) * pageSize;
    const visible = filtered.slice(0, end);

    const result = { fileObjs, filtered, visible };
    this._visibleFilesCache = {
      fileObjs,
      baseDir: rootPath,
      activeFolder: this._activeFolder,
      quickFilter: this._quickFilter,
      tagFilter: this._tagFilter,
      query,
      page: this.page,
      filterRevision: this._filterRevision,
      result
    };
    return result;
  }

  _normalizeTags(rawTags) {
    const values = Array.isArray(rawTags)
      ? rawTags
      : String(rawTags || "").split(/[,;\n]/);
    const normalized = [];
    const seen = new Set();

    for (const rawTag of values) {
      const tag = String(rawTag || "").trim().toLowerCase().slice(0, 40);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      normalized.push(tag);
      if (normalized.length >= 30) break;
    }

    return normalized;
  }

  _getAvailableTags(fileObjs) {
    if (this._availableTagsCache?.fileObjs === fileObjs) {
      for (const entry of this._availableTagsCache.tags) {
        entry.selected = entry.tag === this._tagFilter;
      }
      return this._availableTagsCache.tags;
    }

    const counts = new Map();
    for (const file of fileObjs) {
      for (const tag of file.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }

    const tags = Array.from(counts, ([tag, count]) => ({
      tag,
      count,
      selected: tag === this._tagFilter
    })).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }));

    this._availableTagsCache = { fileObjs, tags };
    return tags;
  }

  _clearTreeSelection(node) {
    if (!node) return;
    node.selected = false;
    for (const child of node.children || []) this._clearTreeSelection(child);
  }

  _getImageDetailsData(path, fileObjs = this._getFileObjects()) {
    const selectedImage = path
      ? fileObjs.find((file) => file.path === path) ?? null
      : null;
    if (selectedImage) {
      selectedImage.scenePresetForm = prepareScenePresetForm(selectedImage.scenePreset, {
        gridSizeMax: this._getGridSizeMax()
      });
    }

    return {
      selectedImage,
      imageGridSizeMin: 50,
      imageGridSizeMax: this._getGridSizeMax(),
      imageGridSizeStep: 25,
      selectedSceneAvailable: !!this._getSelectedScene()
    };
  }

  getData() {
    const baseDir = game.settings.get(MODULE_ID, "baseDir");
    const recursive = game.settings.get(MODULE_ID, "recursive");
    const fileObjs = this._getFileObjects();
    const tree = this._buildTree(fileObjs, baseDir);
    const { filtered, visible } = this._getVisibleFiles(fileObjs, baseDir);
    this._canLoadMore = visible.length < filtered.length;
    const nodeMap = this._treeCache?.fileObjs === fileObjs
      ? this._treeCache.nodeMap
      : null;
    const activeNode = nodeMap?.get(this._activeFolder)
      ?? this._findTreeNode(tree, this._activeFolder)
      ?? tree;
    const pinnedFolders = Array.from(this._pinnedFolders)
      .map((fullPath) => nodeMap?.get(fullPath) ?? this._findTreeNode(tree, fullPath))
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    const quickFilterActive = this._quickFilter !== "all";
    if (quickFilterActive || this._tagFilter) this._clearTreeSelection(tree);
    const availablePaths = new Set(fileObjs.map((file) => file.path));
    const favoriteCount = fileObjs.filter((file) => file.favorite).length;
    const recentCount = this._recentImages.filter((path) => availablePaths.has(path)).length;
    const availableTags = this._getAvailableTags(fileObjs);

    let activeFolderLabel;
    let activeFolderPath;
    if (this._quickFilter === "favorites") {
      activeFolderLabel = this._tagFilter ? `Favorites · #${this._tagFilter}` : "Favorites";
      activeFolderPath = "Favorite images from all indexed folders";
    } else if (this._quickFilter === "recent") {
      activeFolderLabel = this._tagFilter ? `Recently Displayed · #${this._tagFilter}` : "Recently Displayed";
      activeFolderPath = "Most recently displayed images from all indexed folders";
    } else if (this._tagFilter) {
      activeFolderLabel = `#${this._tagFilter}`;
      activeFolderPath = "Tagged images from all indexed folders";
    } else {
      activeFolderLabel = activeNode === tree ? "All Media" : activeNode.label;
      activeFolderPath = activeNode === tree
        ? (this._normalizeBaseDir(baseDir)
          ? `${this._normalizeBaseDir(baseDir)} ${recursive ? "(including subfolders)" : "(this folder only)"}`
          : "Choose a folder to begin")
        : activeNode.fullPath;
    }
    const hasOrganizationFilter = quickFilterActive || !!this._tagFilter;
    let emptyIcon = "fa-image";
    let emptyTitle = "This folder is empty";
    let emptyMessage = "Choose another folder or add images here.";
    if (this.filter) {
      emptyIcon = "fa-magnifying-glass";
      emptyTitle = "No matching images";
      emptyMessage = "Try a different search or clear the current one.";
    } else if (this._quickFilter === "favorites") {
      emptyIcon = "fa-star";
      emptyTitle = "No favorite images";
      emptyMessage = "Use the star on an image card to add it to Favorites.";
    } else if (this._quickFilter === "recent") {
      emptyIcon = "fa-clock-rotate-left";
      emptyTitle = "No recently displayed images";
      emptyMessage = "Images appear here after you set them as a Scene background.";
    } else if (this._tagFilter) {
      emptyIcon = "fa-tag";
      emptyTitle = `No images tagged #${this._tagFilter}`;
      emptyMessage = "Choose another tag or edit an image's Scene Details.";
    }

    return {
      baseDir,
      recursive,
      imageTitleFontSize: this._getImageTitleFontSize(),
      filter: this.filter,
      totalIndexed: this.total,
      totalFiltered: filtered.length,
      showing: visible.length,
      canLoadMore: this._canLoadMore,
      isIndexing: !!this.loading,
      isUploading: !!this._isUploading,
      indexStats: this._indexStats,
      tree,
      pinnedFolders,
      availableTags,
      sidebarCollapsed: this._sidebarCollapsed,
      favoriteCount,
      recentCount,
      favoritesSelected: this._quickFilter === "favorites",
      recentSelected: this._quickFilter === "recent",
      quickFilterActive,
      tagFilter: this._tagFilter,
      hasOrganizationFilter,
      emptyIcon,
      emptyTitle,
      emptyMessage,
      searchPlaceholder: hasOrganizationFilter ? "Search this view" : "Search this folder",
      visibleFiles: visible,
      activeFolderLabel,
      activeFolderPath,
      sceneData: this._prepareSceneData(),
      singleFiltered: filtered.length === 1
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const root = this.element;
    this._loadMorePending = false;
    this._setLoadingMoreOverlay(this._isLoadingMore, root);
    if (this._galleryInteractionRoot !== root) {
      this._removeGalleryInteractionListeners();
      this._galleryInteractionRoot = root;
      root.addEventListener("click", this._galleryInteractionHandler);
      root.addEventListener("contextmenu", this._galleryInteractionHandler);
      root.addEventListener("keydown", this._galleryInteractionHandler);
      root.addEventListener("error", this._galleryInteractionHandler, true);
    }
    this._pauseActiveThumbnailVideo();
    this._thumbnailVideoObserver?.disconnect?.();
    this._thumbnailVideoObserver = null;

    const galleryScroll = root.querySelector(".mg-gallery-scroll");
    if (this._galleryScrollElement !== galleryScroll) {
      this._galleryScrollElement?.removeEventListener("scroll", this._galleryScrollHandler);
      this._galleryScrollElement = galleryScroll;
      galleryScroll?.addEventListener("scroll", this._galleryScrollHandler, { passive: true });
    }
    this._scheduleGalleryLoadCheck(galleryScroll);
    if (this._isLoadingMore) {
      if (this._loadMoreCompleteTimer) clearTimeout(this._loadMoreCompleteTimer);
      this._loadMoreCompleteTimer = setTimeout(() => {
        this._loadMoreCompleteTimer = null;
        if (this._isClosing) return;
        this._isLoadingMore = false;
        this._setLoadingMoreOverlay(false);
        this._scheduleGalleryLoadCheck(this._galleryScrollElement);
      }, 120);
    }

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

    this._bindThumbnailVideos(root);

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

  _removeGalleryInteractionListeners() {
    const root = this._galleryInteractionRoot;
    if (!root) return;

    root.removeEventListener("click", this._galleryInteractionHandler);
    root.removeEventListener("contextmenu", this._galleryInteractionHandler);
    root.removeEventListener("keydown", this._galleryInteractionHandler);
    root.removeEventListener("error", this._galleryInteractionHandler, true);
    this._galleryInteractionRoot = null;
  }

  _setLoadingMoreOverlay(visible, root = this.element) {
    const overlay = root?.querySelector?.("[data-role='loading-more']");
    if (!overlay) return;

    overlay.hidden = !visible;
    overlay.setAttribute("aria-hidden", String(!visible));
  }

  _handleGalleryInteraction(event) {
    const target = event.target;
    if (event.type === "error") {
      if (!target?.matches?.(".mg-thumb .mg-img")) return;
      const thumb = target.closest(".mg-thumb");
      if (thumb) thumb.classList.add("is-missing");
      target.style.display = "none";
      return;
    }

    const thumb = target?.closest?.(".mg-thumb");
    if (!thumb || !this.element?.contains?.(thumb)) return;

    if (event.type === "click") this._selectImage(event);
    else if (event.type === "contextmenu") this._openSceneDetails(event);
    else if (event.type === "keydown") {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (target?.closest?.("[data-action]")) return;
      event.preventDefault();
      this._selectImage(event);
    }
  }

  _bindThumbnailVideos(root) {
    const videos = Array.from(root.querySelectorAll(".mg-thumb .mg-video"));
    if (!videos.length) return;

    const play = (video) => {
      if (!video?.isConnected) return;
      if (this._activeThumbnailVideo && this._activeThumbnailVideo !== video) {
        pause(this._activeThumbnailVideo);
      }
      this._activeThumbnailVideo = video;
      const promise = video.play();
      promise?.catch?.(() => {
        if (this._activeThumbnailVideo === video) this._activeThumbnailVideo = null;
      });
    };
    const pause = (video) => {
      if (!video) return;
      if (this._activeThumbnailVideo === video) this._activeThumbnailVideo = null;
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // Ignore media elements which are not ready to seek.
      }
    };

    if (typeof IntersectionObserver === "function") {
      const scrollRoot = root.querySelector(".mg-gallery-scroll");
      this._thumbnailVideoObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) play(entry.target);
          else pause(entry.target);
        }
      }, {
        root: scrollRoot ?? null,
        threshold: 0.1
      });

      videos.forEach((video) => this._thumbnailVideoObserver.observe(video));
      return;
    }

    for (const video of videos) {
      const thumb = video.closest(".mg-thumb");
      thumb?.addEventListener("pointerenter", () => play(video));
      thumb?.addEventListener("pointerleave", () => pause(video));
      thumb?.addEventListener("focusin", () => play(video));
      thumb?.addEventListener("focusout", (event) => {
        if (!thumb.contains(event.relatedTarget)) pause(video);
      });
    }
  }

  _getOwningScene(document) {
    const seen = new Set();
    let current = document;

    while (current && !seen.has(current)) {
      if (current.documentName === "Scene") return current;
      seen.add(current);
      current = current.parent;
    }

    return null;
  }

  _isRelevantSceneHook(document) {
    const selectedScene = this._getSelectedScene();
    if (!selectedScene?.id) return false;

    const owningScene = this._getOwningScene(document)
      ?? (document?.id === selectedScene.id ? document : null);
    return owningScene?.id === selectedScene.id;
  }

  _scheduleSceneRerender() {
    if (this._sceneRerenderTimer || this._isClosing) return;

    this._sceneRerenderTimer = setTimeout(() => {
      this._sceneRerenderTimer = null;
      if (this._isClosing) return;
      this._safeRender(false);
    }, 50);
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    const rerenderSceneData = (document) => {
      if (!this._isRelevantSceneHook(document)) return;
      this._scheduleSceneRerender();
    };
    const rerenderAfterCanvasReady = () => this._scheduleSceneRerender();
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
      const callback = hookName === "canvasReady"
        ? rerenderAfterCanvasReady
        : rerenderSceneData;
      const hookId = Hooks.on(hookName, callback);
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
    this._quickFilter = "all";
    this._tagFilter = "";
    this._openFolderAncestors(folder);
    this.page = 0;
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

  _selectQuickFilter(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const filter = target?.dataset?.filter;
    if (!["favorites", "recent"].includes(filter)) return;

    this._quickFilter = this._quickFilter === filter ? "all" : filter;
    this.page = 0;
    this._safeRender(false);
  }

  _selectTagFilter(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const tag = this._normalizeTags([target?.dataset?.tag])[0];
    if (!tag) return;

    this._tagFilter = this._tagFilter === tag ? "" : tag;
    this.page = 0;
    this._safeRender(false);
  }

  async _toggleFavorite(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const path = target?.dataset?.path;
    if (!path) return;

    const wasFavorite = this._favoriteImages.has(path);
    if (wasFavorite) this._favoriteImages.delete(path);
    else this._favoriteImages.add(path);

    try {
      await game.settings.set(MODULE_ID, "favoriteImages", Array.from(this._favoriteImages));
      const label = target?.dataset?.title || String(path).split("/").pop() || "Image";
      ui.notifications.info(
        wasFavorite ? `Removed ${label} from Favorites.` : `Added ${label} to Favorites.`
      );
    } catch (error) {
      if (wasFavorite) this._favoriteImages.add(path);
      else this._favoriteImages.delete(path);
      console.error(`${MODULE_ID} | Could not update Favorite image`, error);
      ui.notifications.error("Could not update Favorites.");
    } finally {
      this._filterRevision += 1;
      this._safeRender(false);
    }
  }

  async _recordRecentlyDisplayed(path) {
    const previous = [...this._recentImages];
    this._recentImages = [
      path,
      ...this._recentImages.filter((recentPath) => recentPath !== path)
    ].slice(0, MAX_RECENT_IMAGES);

    try {
      await game.settings.set(MODULE_ID, "recentImages", this._recentImages);
    } catch (error) {
      this._recentImages = previous;
      console.error(`${MODULE_ID} | Could not update Recently Displayed images`, error);
      ui.notifications.warn("Displayed the image, but could not update Recently Displayed.");
    } finally {
      this._filterRevision += 1;
      this._safeRender(false);
    }
  }

  _copyCurrentScenePreset(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const scene = this._getSelectedScene();
    const sectionFields = SCENE_PRESET_SECTION_FIELDS[target?.dataset?.presetSection];
    const form = target?.closest?.("[data-role='image-details-form']")
      ?? target?.ownerDocument?.querySelector?.("[data-role='image-details-form']")
      ?? this.element?.querySelector?.("[data-role='image-details-form']");
    if (!scene || !form || !sectionFields) return;

    const preset = captureScenePreset(scene, { gridSizeMax: this._getGridSizeMax() });
    const prepared = prepareScenePresetForm(preset, { gridSizeMax: this._getGridSizeMax() });
    const setValue = (name, value) => {
      const field = form.elements?.[name];
      if (field) field.value = value ?? "";
    };

    for (const [name, value] of Object.entries(preset)) {
      if (!sectionFields.has(name)) continue;

      if (name === "weather") {
        setValue(name, value === null ? KEEP_CURRENT : value);
      } else if (name === "lightSources") {
        setValue(name, prepared.lightSourcesJson);
      } else if (name === "initialScale") {
        setValue(name, value === null ? null : value.toFixed(2));
      } else {
        setValue(name, value);
      }
    }
    if (sectionFields.has("lightSources")) {
      const lightSourcesSummary = target?.ownerDocument?.querySelector?.(
        "[data-role='light-source-summary']"
      ) ?? this.element?.querySelector?.("[data-role='light-source-summary']");
      if (lightSourcesSummary) lightSourcesSummary.textContent = prepared.lightSourcesSummary;
    }
  }

  async _runLinkedContentActions(image) {
    const preset = image?.scenePreset;
    if (!preset) return;

    if (preset.journal) {
      try {
        const journal = game.journal?.get?.(preset.journal);
        if (!journal) throw new Error(`Journal ${preset.journal} was not found.`);
        const sheet = journal.sheet;
        if (!sheet?.render) throw new Error(`Journal ${journal.name || preset.journal} has no sheet.`);
        await sheet.render(true);
      } catch (error) {
        console.error(`${MODULE_ID} | Could not open linked Journal`, error);
        ui.notifications.warn("The linked Journal could not be opened.");
      }
    }

    if (preset.playlist) {
      try {
        const playlist = game.playlists?.get?.(preset.playlist);
        if (!playlist) throw new Error(`Playlist ${preset.playlist} was not found.`);

        if (preset.playlistSound) {
          const sound = playlist.sounds?.get?.(preset.playlistSound);
          if (!sound) {
            throw new Error(
              `Playlist Sound ${preset.playlistSound} was not found in ${playlist.name || preset.playlist}.`
            );
          }
          await playlist.playSound(sound);
        } else {
          await playlist.playAll();
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Could not start linked Playlist audio`, error);
        ui.notifications.warn("The linked Playlist audio could not be started.");
      }
    }
  }

  _pauseActiveThumbnailVideo() {
    const video = this._activeThumbnailVideo;
    if (!video) return;

    this._activeThumbnailVideo = null;
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // Ignore media elements which are not ready to seek.
    }
  }

  async _clearImageMetadata(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const form = target?.closest?.("[data-role='image-details-form']");
    const path = target?.dataset?.path || form?.dataset?.path;
    if (!path) return;

    const savedMetadata = game.settings.get(MODULE_ID, "imageMetadata");
    const nextMetadata = savedMetadata
      && typeof savedMetadata === "object"
      && !Array.isArray(savedMetadata)
      ? { ...savedMetadata }
      : {};
    const savedTitles = game.settings.get(MODULE_ID, "imageTitles");
    const nextTitles = savedTitles
      && typeof savedTitles === "object"
      && !Array.isArray(savedTitles)
      ? { ...savedTitles }
      : {};
    const hadMetadata = Object.prototype.hasOwnProperty.call(nextMetadata, path);
    const hadLegacyTitle = Object.prototype.hasOwnProperty.call(nextTitles, path);

    if (!hadMetadata && !hadLegacyTitle) return;

    delete nextMetadata[path];
    delete nextTitles[path];
    if (target) target.disabled = true;

    let cleared = false;
    let metadataChanged = false;
    try {
      if (hadMetadata) {
        await game.settings.set(MODULE_ID, "imageMetadata", nextMetadata);
        metadataChanged = true;
      }
      if (hadLegacyTitle) {
        await game.settings.set(MODULE_ID, "imageTitles", nextTitles);
        metadataChanged = true;
      }
      ui.notifications.info("Image metadata cleared.");
      cleared = true;
    } catch (error) {
      console.error(`${MODULE_ID} | Could not clear image metadata`, error);
      ui.notifications.error("Could not clear the image metadata.");
    } finally {
      if (target) target.disabled = false;
      if (metadataChanged) this._invalidateFileObjectsCache();
      this._safeRender(false);
    }

    return cleared;
  }

  async _saveImageDetails(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const path = form?.dataset?.path;
    if (!path) return;

    const title = String(form.elements?.title?.value ?? "").trim();
    const tags = this._normalizeTags(form.elements?.tags?.value);
    const savedMetadata = game.settings.get(MODULE_ID, "imageMetadata");
    const currentMetadata = savedMetadata
      && typeof savedMetadata === "object"
      && !Array.isArray(savedMetadata)
      ? savedMetadata
      : {};
    const currentImageMetadata = currentMetadata[path]
      && typeof currentMetadata[path] === "object"
      && !Array.isArray(currentMetadata[path])
      ? currentMetadata[path]
      : {};
    const description = typeof currentImageMetadata.description === "string"
      ? currentImageMetadata.description.trim()
      : "";
    const existingPreset = normalizeScenePreset(currentImageMetadata.scenePreset, {
      gridSizeMax: this._getGridSizeMax()
    });
    const scenePreset = readScenePresetForm(form, {
      gridSizeMax: this._getGridSizeMax(),
      fallbackBackgroundColor: existingPreset.backgroundColor
    });

    const nextMetadata = { ...currentMetadata };
    nextMetadata[path] = {
      title,
      description,
      tags,
      gridSize: scenePreset.gridSize,
      scenePreset
    };

    const submit = form.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;

    let saved = false;
    try {
      await game.settings.set(MODULE_ID, "imageMetadata", nextMetadata);
      this._invalidateFileObjectsCache();
      ui.notifications.info("Image details saved.");
      saved = true;
    } catch (error) {
      console.error(`${MODULE_ID} | Could not save image details`, error);
      ui.notifications.error("Could not save the image details.");
    } finally {
      if (submit) submit.disabled = false;
      this._safeRender(false);
    }

    return saved;
  }

  async _setSceneBackground(event, target = event.currentTarget) {
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
        ui.notifications.warn("Open a scene before setting its background.");
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

    const displayed = await setSceneBackground(scene, path);
    if (!displayed) return;

    await this._recordRecentlyDisplayed(path);
    if (!image?.scenePreset) return;
    await this._runLinkedContentActions(image);

    const activeCanvas = globalThis.canvas;
    if (!activeCanvas?.ready || activeCanvas?.scene?.id !== scene?.id) return;

    const view = {};
    if (image.scenePreset.initialX !== null) view.x = image.scenePreset.initialX;
    if (image.scenePreset.initialY !== null) view.y = image.scenePreset.initialY;
    if (image.scenePreset.initialScale !== null) view.scale = image.scenePreset.initialScale;
    if (Object.keys(view).length) await activeCanvas.animatePan(view);
  }

  async _removeSceneBackground(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    if (target) target.disabled = true;
    try {
      await removeSceneBackground(this._getSelectedScene());
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
    await FilePicker.upload("data", baseDir, file, {}, { notify: false });
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
    input.accept = "image/*,image/webp,.webp,video/webm,.webm";
    input.multiple = true;

    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;

      this._isUploading = true;
      ui.notifications.info(`Uploading ${files.length} media file${files.length === 1 ? "" : "s"} to ${uploadDir}`);
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
          ? `Uploaded ${uploaded} of ${files.length} files before the failure. `
          : "";
        ui.notifications.error(`${progress}Media upload failed: ${uploadError?.message ?? uploadError}`);
      } else {
        ui.notifications.info(`Uploaded ${uploaded} media file${uploaded === 1 ? "" : "s"}.`);
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
    if (this._isClosing || this.loading || this._isLoadingMore || !this._canLoadMore) return;
    this.page += 1;
    this._isLoadingMore = true;
    this._setLoadingMoreOverlay(true);
    this._safeRender(false);
  }

  _maybeLoadMore(scrollElement) {
    if (
      !scrollElement
      || this._isClosing
      || this.loading
      || this._isLoadingMore
      || this._loadMorePending
      || !this._canLoadMore
    ) return;

    const remaining = scrollElement.scrollHeight
      - scrollElement.scrollTop
      - scrollElement.clientHeight;
    if (remaining > 240) return;

    this._loadMorePending = true;
    this._loadMore();
  }

  _scheduleGalleryLoadCheck(scrollElement) {
    if (this._galleryLoadCheckTimer) clearTimeout(this._galleryLoadCheckTimer);
    if (!scrollElement) return;

    this._galleryLoadCheckTimer = setTimeout(() => {
      this._galleryLoadCheckTimer = null;
      if (scrollElement.isConnected) this._maybeLoadMore(scrollElement);
    }, 0);
  }

  async _toggleSidebar(event, target = event?.currentTarget) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    this._sidebarCollapsed = !this._sidebarCollapsed;
    this._safeRender(false);
    target?.blur?.();

    try {
      await game.settings.set(MODULE_ID, "sidebarCollapsed", this._sidebarCollapsed);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not save folder panel state`, error);
    }
  }

  _selectImage(event) {
    if (event.target?.closest?.("[data-action]")) return;
    event.preventDefault();
    event.stopPropagation();

    const thumb = event.currentTarget?.classList?.contains?.("mg-thumb")
      ? event.currentTarget
      : event.target?.closest?.(".mg-thumb");
    const path = thumb?.dataset?.path;
    if (!path) return;
    this._selectedImagePath = path;
    this._safeRender(false);
  }

  _openSceneDetails(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.target?.closest?.("[data-action]")) return;

    const thumb = event.currentTarget?.classList?.contains?.("mg-thumb")
      ? event.currentTarget
      : event.target?.closest?.(".mg-thumb");
    const path = thumb?.dataset?.path;
    if (!path) return;
    this._selectedImagePath = path;
    this._safeRender(false);
    this._showSceneDetails(path);
  }

  async _openImagePreviewAction(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();
    await this._showImagePreview(target?.dataset?.path);
  }

  async _showImagePreview(path) {
    if (!path) return;
    const image = this._getFileObjects().find((candidate) => candidate.path === path);
    if (!image) {
      console.error(`${MODULE_ID} | Could not open preview for missing image`, { path });
      ui.notifications.error("Could not open a preview for this image.");
      return;
    }

    try {
      if (!this._imagePreviewApp) {
        const { ImagePreviewApp } = await import("./imagePreview.js");
        if (this._isClosing) return;
        if (!this._imagePreviewApp) {
          this._imagePreviewApp = new ImagePreviewApp({
            gallery: this,
            image
          });
        }
      }

      this._imagePreviewApp.setImage(image);
      await this._imagePreviewApp.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Could not load image preview`, error);
      ui.notifications.error("Could not open a preview for this image.");
    }
  }

  async _showSceneDetails(path) {
    if (!path) return;
    const image = this._getFileObjects().find((candidate) => candidate.path === path);
    if (!image) {
      console.error(`${MODULE_ID} | Could not open Scene Details for missing image`, { path });
      ui.notifications.error("Could not open Scene Details for this image.");
      return;
    }

    try {
      if (!this._sceneDetailsApp) {
        const { SceneDetailsApp } = await import("./sceneDetails.js");
        if (this._isClosing) return;
        if (!this._sceneDetailsApp) {
          this._sceneDetailsApp = new SceneDetailsApp({
            gallery: this,
            image
          });
        }
      }

      this._sceneDetailsApp.setImage(image);
      await this._sceneDetailsApp.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Could not load Scene Details`, error);
      ui.notifications.error("Could not open Scene Details for this image.");
    }
  }

  _releaseImagePreviewApp(application) {
    if (this._imagePreviewApp === application) this._imagePreviewApp = null;
  }

  _releaseSceneDetailsApp(application) {
    if (this._sceneDetailsApp === application) this._sceneDetailsApp = null;
  }

}
