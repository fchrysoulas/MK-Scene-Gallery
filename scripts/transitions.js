import {
  DEFAULT_TOKEN_LAYER_TRANSITION_MS,
  MODULE_ID
} from "./settings.js";

export function getTokenLayerTransitionDuration() {
  const configured = Number(game.settings.get(MODULE_ID, "tokenLayerTransitionMs"));
  if (!Number.isFinite(configured)) return DEFAULT_TOKEN_LAYER_TRANSITION_MS;
  return Math.min(3000, Math.max(0, Math.round(configured)));
}

function nextAnimationFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16);
}

export function animateAlpha(displayObject, targetAlpha, duration, isCurrent) {
  if (!displayObject || displayObject.destroyed) return Promise.resolve(false);

  const target = Number(targetAlpha);
  const startAlpha = Number(displayObject.alpha);
  if (!Number.isFinite(target) || !Number.isFinite(startAlpha) || duration <= 0) {
    displayObject.alpha = Number.isFinite(target) ? target : 1;
    if (globalThis.canvas?.primary) globalThis.canvas.primary.renderDirty = true;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startTime = globalThis.performance?.now?.() ?? Date.now();

    const step = (timestamp) => {
      if (displayObject.destroyed || !isCurrent()) {
        resolve(false);
        return;
      }

      const elapsed = Math.max(0, timestamp - startTime);
      const progress = Math.min(1, elapsed / duration);
      const eased = progress * progress * (3 - (2 * progress));
      displayObject.alpha = startAlpha + ((target - startAlpha) * eased);
      if (globalThis.canvas?.primary) globalThis.canvas.primary.renderDirty = true;

      if (progress < 1) nextAnimationFrame(step);
      else resolve(true);
    };

    nextAnimationFrame(step);
  });
}
