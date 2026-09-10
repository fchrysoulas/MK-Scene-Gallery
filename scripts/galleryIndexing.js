import { MODULE_ID } from "./settings.js";
import { indexImages, getCachedIndex } from "./fileIndex.js";

export const GalleryIndexingMixin = (Base) => class extends Base {
  _resetIndexState({ activeFolder = "" } = {}) {
    this.page = 0;
    this._openFolders.clear();
    this._activeFolder = activeFolder;
    if (activeFolder) this._openFolderAncestors(activeFolder);

    this.files = [];
    this.total = 0;

    this.loading = false;
    this._indexed = false;
    this._indexPromise = null;

    this._indexStats = { scannedDirs: 0, queuedDirs: 0, foundFiles: 0 };

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

  _updateIndexingProgress(progress) {
    const progressText = this.element?.querySelector?.("[data-role='indexing-progress']");
    if (!progressText) return;

    const foundFiles = Number(progress?.foundFiles) || 0;
    const scannedDirs = Number(progress?.scannedDirs) || 0;
    progressText.textContent = `Indexing media… ${foundFiles} files in ${scannedDirs} folders`;
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
            this._updateIndexingProgress(progress);
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
};
