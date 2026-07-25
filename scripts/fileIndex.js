import { MODULE_ID } from "./settings.js";

const MEDIA_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "webm"]);
const cache = new Map();

function normalizeDir(path) {
  if (path === null || path === undefined) return "";
  return String(path).trim();
}

function getCacheKey(source, baseDir, recursive) {
  return `${source}::${normalizeDir(baseDir)}::${recursive}`;
}

export function getCachedIndex({ source = "data", baseDir, recursive = true } = {}) {
  const key = getCacheKey(source, baseDir, recursive);
  return cache.get(key)?.files ?? null;
}

export function clearIndexCache() {
  cache.clear();
}

function isMediaPath(path) {
  const ext = (String(path).split(".").pop() || "").toLowerCase();
  return MEDIA_EXT.has(ext);
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out while browsing ${label}`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function indexImages({
  source = "data",
  baseDir,
  recursive = true,
  maxConcurrent = 4,
  browseTimeoutMs = 15000,
  onBatch = null,
  onProgress = null
} = {}) {
  const startDir = normalizeDir(baseDir);
  const key = getCacheKey(source, startDir, recursive);

  const cached = cache.get(key);
  if (cached) return cached.files;

  if (!startDir) {
    const empty = [];
    cache.set(key, { files: empty, indexedAt: Date.now() });
    if (typeof onProgress === "function") {
      onProgress({
        scannedDirs: 0,
        queuedDirs: 0,
        foundFiles: 0
      });
    }
    return empty;
  }

  const seenDirs = new Set();
  const seenFiles = new Set();
  const out = [];
  const queue = [startDir];

  let active = 0;
  let finalized = false;

  const emitProgress = () => {
    if (typeof onProgress === "function") {
      onProgress({
        scannedDirs: seenDirs.size,
        queuedDirs: queue.length,
        foundFiles: out.length
      });
    }
  };

  return await new Promise((resolve) => {
    const finalize = () => {
      if (finalized) return;
      finalized = true;

      out.sort((a, b) => a.localeCompare(b));
      cache.set(key, { files: out, indexedAt: Date.now() });
      resolve(out);
    };

    const pump = () => {
      while (active < maxConcurrent && queue.length > 0) {
        const rawDir = queue.shift();
        const dir = normalizeDir(rawDir);

        if (!dir) continue;
        if (seenDirs.has(dir)) continue;

        seenDirs.add(dir);
        active += 1;

        withTimeout(FilePicker.browse(source, dir), browseTimeoutMs, dir)
          .then((result) => {
            const files = Array.isArray(result?.files) ? result.files : [];
            const dirs = Array.isArray(result?.dirs) ? result.dirs : [];
            const newFiles = [];

            for (const file of files) {
              if (!isMediaPath(file)) continue;
              if (seenFiles.has(file)) continue;

              seenFiles.add(file);
              out.push(file);
              newFiles.push(file);
            }

            if (recursive) {
              for (const subdir of dirs) {
                const normalized = normalizeDir(subdir);
                if (!normalized) continue;
                if (!seenDirs.has(normalized)) queue.push(normalized);
              }
            }

            if (newFiles.length && typeof onBatch === "function") {
              onBatch(newFiles);
            }
          })
          .catch((error) => {
            console.warn(`${MODULE_ID} | Failed to browse ${dir}`, error);
          })
          .finally(() => {
            active -= 1;
            emitProgress();

            if (queue.length === 0 && active === 0) {
              finalize();
              return;
            }

            pump();
          });
      }

      emitProgress();

      if (queue.length === 0 && active === 0) {
        finalize();
      }
    };

    pump();
  });
}
