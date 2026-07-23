import { MODULE_ID } from "./settings.js";

function getShareMediaAPI() {
  const legacy = globalThis?.["share-media"]?.API;
  if (legacy) return { api: legacy, source: 'window["share-media"].API' };

  const moduleApi = game?.modules?.get?.("share-media")?.api;
  if (moduleApi) return { api: moduleApi, source: "game.modules.get('share-media').api" };

  return { api: null, source: "not-found" };
}

async function callBound(api, fnName, argsArray) {
  const fn = api?.[fnName];
  if (typeof fn !== "function") return { ok: false, error: null };

  try {
    await fn.apply(api, argsArray);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function openShareMediaDialog(src) {
  const shareMedia = game.modules.get("share-media");
  if (!shareMedia?.active) {
    ui.notifications.error("Share Media is not enabled.");
    return false;
  }

  const { api, source } = getShareMediaAPI();
  if (!api) {
    ui.notifications.error("Share Media API not found.");
    console.warn(`${MODULE_ID} | Share Media API not found.`);
    return false;
  }

  const attempts = [
    [src],
    [src, { mode: "share" }],
    [{ src }]
  ];

  for (const args of attempts) {
    const result = await callBound(api, "shareDialog", args);
    if (result.ok) return true;
  }

  ui.notifications.error(`Could not open Share Media for: ${src}`);
  console.warn(`${MODULE_ID} | shareDialog failed. API source: ${source}`);
  return false;
}

export async function openShareMediaPopout(src) {
  const shareMedia = game.modules.get("share-media");
  if (!shareMedia?.active) {
    ui.notifications.error("Share Media is not enabled.");
    return false;
  }

  const { api, source } = getShareMediaAPI();
  if (!api) {
    ui.notifications.error("Share Media API not found.");
    console.warn(`${MODULE_ID} | Share Media API not found.`);
    return false;
  }

  const methodAttempts = [
    { name: "sharePopout", args: [src] },
    { name: "sharePopout", args: [{ src }] },
    { name: "shareToPopout", args: [src] },
    { name: "shareToPopout", args: [{ src }] },
    { name: "shareInPopout", args: [src] },
    { name: "shareInPopout", args: [{ src }] },
    { name: "openPopout", args: [src] },
    { name: "openPopout", args: [{ src }] },
    { name: "openPopoutDialog", args: [src] },
    { name: "openPopoutDialog", args: [{ src }] },
    { name: "popout", args: [src] },
    { name: "popout", args: [{ src }] },
    { name: "shareDialog", args: [src, { mode: "popout" }] },
    { name: "shareDialog", args: [src, { display: "popout" }] },
    { name: "shareDialog", args: [{ src, mode: "popout" }] },
    { name: "shareDialog", args: [{ src, display: "popout" }] }
  ];

  let lastError = null;

  for (const attempt of methodAttempts) {
    const result = await callBound(api, attempt.name, attempt.args);
    if (result.ok) return true;
    if (result.error) lastError = result.error;
  }

  console.warn(`${MODULE_ID} | No popout-only API method succeeded (API source: ${source}). Falling back to shareDialog.`);
  if (lastError) console.warn(`${MODULE_ID} | Last popout attempt error:`, lastError);

  return await openShareMediaDialog(src);
}

export async function shareSelectedOnScene() {
  ui.notifications.warn("shareSelectedOnScene is not used by the Share button in this configuration.");
  return false;
}
