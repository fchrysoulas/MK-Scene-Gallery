import { MODULE_ID } from "./settings.js";

export const IMAGE_EXTENSIONS = Object.freeze([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "svg"
]);
export const VIDEO_EXTENSIONS = Object.freeze(["webm"]);
const MEDIA_EXT = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
const cache = new Map();
const MAX_CACHED_INDEXES = 8;
let cacheGeneration = 0;

function rememberIndex(key, files) {
  cache.delete(key);
  cache.set(key, { files });
  while (cache.size > MAX_CACHED_INDEXES) cache.delete(cache.keys().next().value);
}

function readIndex(key) {
  const entry = cache.get(key);
  if (entry) rememberIndex(key, entry.files);
  return entry?.files ?? null;
}

function normalizeDir(path) {
  if (path === null || path === undefined) return "";
  return String(path).trim();
}

function getCacheKey(source, baseDir, recursive) {
  return `${source}::${normalizeDir(baseDir)}::${recursive}`;
}

export function getCachedIndex({ source = "data", baseDir, recursive = true } = {}) {
  const key = getCacheKey(source, baseDir, recursive);
  return readIndex(key);
}

export function clearIndexCache() {
  cacheGeneration += 1;
  cache.clear();
}

function getMediaExtension(path) {
  const withoutQuery = String(path).split(/[?#]/, 1)[0];
  return (withoutQuery.split(".").pop() || "").toLowerCase();
}

export function getMediaType(path) {
  const extension = getMediaExtension(path);
  if (VIDEO_EXTENSIONS.includes(extension)) return "video";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  return null;
}

function isMediaPath(path) {
  return MEDIA_EXT.has(getMediaExtension(path));
}

function withTimeout(promise, ms, label, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => finish(reject, new DOMException("Indexing cancelled", "AbortError"));
    if (signal?.aborted) {
      Promise.resolve(promise).catch(() => {});
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (ms > 0) timer = setTimeout(() => finish(reject, new Error(`Timed out while browsing ${label}`)), ms);
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

export async function indexImages({
  source = "data",
  baseDir,
  recursive = true,
  maxConcurrent = 4,
  browseTimeoutMs = 15000,
  onBatch = null,
  onProgress = null,
  signal = null
} = {}) {
  if (signal?.aborted) throw new DOMException("Indexing cancelled", "AbortError");
  const startDir = normalizeDir(baseDir);
  const key = getCacheKey(source, startDir, recursive);
  const generation = cacheGeneration;
  const concurrency = Math.min(16, Math.max(1, Math.floor(Number(maxConcurrent)) || 4));

  const cached = readIndex(key);
  if (cached) return cached;

  if (!startDir) {
    const empty = [];
    rememberIndex(key, empty);
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
  const queuedDirs = new Set(queue);
  let queueIndex = 0;
  const FilePicker = foundry.applications.apps.FilePicker.implementation;

  let active = 0;
  let finalized = false;

  const emitProgress = () => {
    if (typeof onProgress === "function") {
      onProgress({
        scannedDirs: seenDirs.size,
        queuedDirs: queue.length - queueIndex,
        foundFiles: out.length
      });
    }
  };

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      // Do not keep gallery callbacks alive while an underlying FilePicker
      // request finishes after cancellation or a browse timeout.
      onBatch = null;
      onProgress = null;
    };
    const abort = () => {
      if (finalized) return;
      finalized = true;
      queue.length = 0;
      cleanup();
      reject(new DOMException("Indexing cancelled", "AbortError"));
    };
    const finalize = () => {
      if (finalized) return;
      finalized = true;

      out.sort((a, b) => a.localeCompare(b));
      if (generation === cacheGeneration) rememberIndex(key, out);
      cleanup();
      resolve(out);
    };

    const pump = () => {
      if (finalized) return;
      while (active < concurrency && queueIndex < queue.length) {
        const rawDir = queue[queueIndex++];
        const dir = normalizeDir(rawDir);

        if (!dir) continue;
        if (seenDirs.has(dir)) continue;

        seenDirs.add(dir);
        active += 1;

        withTimeout(Promise.resolve().then(() => {
          if (signal?.aborted) throw new DOMException("Indexing cancelled", "AbortError");
          return FilePicker.browse(source, dir);
        }), browseTimeoutMs, dir, signal)
          .then((result) => {
            if (finalized) return;
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
                if (!queuedDirs.has(normalized)) {
                  queuedDirs.add(normalized);
                  queue.push(normalized);
                }
              }
            }

            if (newFiles.length && typeof onBatch === "function") {
              onBatch(newFiles);
            }
          })
          .catch((error) => {
            if (finalized || error?.name === "AbortError") return;
            console.warn(`${MODULE_ID} | Failed to browse ${dir}`, error);
          })
          .finally(() => {
            active -= 1;
            if (finalized) return;
            emitProgress();

            if (queueIndex >= queue.length && active === 0) {
              finalize();
              return;
            }

            pump();
          });
      }

      emitProgress();

      if (queueIndex >= queue.length && active === 0) {
        finalize();
      }
    };

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else pump();
  });
}
