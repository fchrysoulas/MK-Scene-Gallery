import { MODULE_ID } from "./settings.js";
import { indexImages, getCachedIndex, clearIndexCache } from "./fileIndex.js";
import { openShareMediaPopout } from "./share.js";

export class MediaGalleryApp extends Application {
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

    this._indexRunId = 0;
    this._isClosing = false;
    this._initialIndexScheduled = false;
    this._isUploading = false;
  }

  static get defaultOptions() {
    const version = game.modules.get(MODULE_ID)?.version ?? "0.0.0";

    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mk-scene-gallery-app",
      title: `MK-Scene-Gallery v${version}`,
      template: `modules/${MODULE_ID}/templates/gallery.hbs`,
      width: 980,
      height: 720,
      resizable: true,
      scrollY: [".mg-scroll"]
    });
  }

  async close(options = {}) {
    this._isClosing = true;
    this._indexRunId += 1;
    this.loading = false;
    this._indexPromise = null;
    return super.close(options);
  }

  _safeRender(force = false) {
    if (this._isClosing) return;

    const states = Application.RENDER_STATES ?? {};
    if (this._state === states.CLOSED || this._state === states.CLOSING) return;

    this.render(force);
  }

  _resetIndexState() {
    this.page = 0;
    this.selected.clear();
    this._openFolders.clear();

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

  async render(force, options) {
    return super.render(force, options);
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
      node.children.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
      node.files.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
      node.children.forEach(sortNode);
    };

    sortNode(root);
    return root;
  }

  _getVisibleFiles() {
    const pageSize = game.settings.get(MODULE_ID, "pageSize");

    const fileObjs = (this.files || []).map((path) => {
      const label = String(path).split("/").pop() || String(path);
      const url = this._toServedUrl(path);
      const fullPath = String(path);
      const lastSlash = fullPath.lastIndexOf("/");
      const folder = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "";

      return { path, url, label, folder };
    });

    const query = (this.filter || "").trim().toLowerCase();
    const filtered = fileObjs.filter((file) => {
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
    const { filtered, visible } = this._getVisibleFiles();
    const tree = this._buildTree(visible, baseDir);

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
      selectedCount: this.selected.size,
      selectedMap,
      selectedPath
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='pick-folder']").on("click", () => this._pickFolder());
    html.find("[data-action='add-image']").on("click", () => this._addImage());
    html.find("[data-action='refresh-gallery']").on("click", () => this._refreshGallery());
    html.find("[data-action='toggle-recursive']").on("change", (event) => this._toggleRecursive(event));
    html.find("[data-action='load-more']").on("click", () => this._loadMore());

    html.find("[data-action='share-file']").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const path = event.currentTarget?.dataset?.path;
      if (!path) {
        ui.notifications.warn("No image path found.");
        return;
      }

      await openShareMediaPopout(path);
    });

    html.find(".mg-thumb").on("click", (event) => this._onThumbClick(event));

    html.find("details.mg-folder").on("toggle", (event) => {
      const details = event.currentTarget;
      const key = details?.dataset?.folder;
      if (!key) return;

      if (details.open) this._openFolders.add(key);
      else this._openFolders.delete(key);
    });

    html.find(".mg-thumb img").on("error", (event) => {
      const img = event.currentTarget;
      const thumb = img.closest(".mg-thumb");
      if (thumb) thumb.classList.add("is-missing");
      img.style.display = "none";
    });

    if (!this._initialIndexScheduled && !this._indexed && !this.loading && !this._indexPromise) {
      this._scheduleInitialIndex();
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
