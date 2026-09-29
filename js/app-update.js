/**
 * Startup update check for the installed PWA / browser tab.
 * Compares published version.json to the bundled APP_VERSION, then
 * activates any waiting service worker so the next (or immediate) load
 * gets the latest shell + precached examples from GitHub Pages.
 */

import { APP_VERSION } from "./version.js";

const VERSION_URL = "./version.json";
const RELOAD_FLAG = "mpp-sw-reloading";
const UPDATED_FLAG = "mpp-just-updated";

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
export function compareSemver(a, b) {
  const pa = String(a || "0")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function isNewerVersion(remote, local) {
  return compareSemver(remote, local) > 0;
}

/**
 * @returns {string|null} version label that was just applied, if any
 */
export function consumeJustUpdatedLabel() {
  try {
    const v = sessionStorage.getItem(UPDATED_FLAG);
    if (!v) return null;
    sessionStorage.removeItem(UPDATED_FLAG);
    return v.startsWith("v") ? v : `v${v}`;
  } catch {
    return null;
  }
}

/**
 * @param {ServiceWorkerRegistration} reg
 * @returns {Promise<ServiceWorker|null>}
 */
function waitForInstalledWorker(reg) {
  const installing = reg.installing;
  if (!installing) return Promise.resolve(reg.waiting || null);
  return new Promise((resolve) => {
    if (installing.state === "installed") {
      resolve(installing);
      return;
    }
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") resolve(installing);
      if (installing.state === "redundant") resolve(reg.waiting || null);
    });
  });
}

/**
 * @param {ServiceWorker} worker
 * @param {string|null} [remoteVersion]
 */
function activateWaiting(worker, remoteVersion = null) {
  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
    if (remoteVersion) sessionStorage.setItem(UPDATED_FLAG, remoteVersion);
  } catch {
    /* ignore */
  }
  worker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Fetch the published version from Pages (bypasses HTTP cache).
 * @returns {Promise<string|null>}
 */
export async function fetchPublishedVersion() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const res = await fetch(VERSION_URL, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const v = data?.version;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Register the service worker, check Pages for a newer release, and
 * activate it (reload) when one is waiting.
 *
 * @param {{
 *   onStatus?: (msg: string) => void,
 *   onError?: (msg: string) => void,
 * }} [opts]
 * @returns {Promise<{ updated: boolean, remoteVersion: string|null }>}
 */
export async function checkForAppUpdate(opts = {}) {
  const { onStatus, onError } = opts;
  if (!("serviceWorker" in navigator)) {
    return { updated: false, remoteVersion: null };
  }

  // Avoid reload loops if controllerchange fires repeatedly.
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") {
      sessionStorage.removeItem(RELOAD_FLAG);
      // Stamp the version we landed on after the reload.
      sessionStorage.setItem(UPDATED_FLAG, APP_VERSION);
    }
  } catch {
    /* ignore */
  }

  let remoteVersion = null;
  try {
    onStatus?.("checking");
    remoteVersion = await fetchPublishedVersion();
  } catch {
    remoteVersion = null;
  }

  let reg;
  try {
    reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  } catch (err) {
    onError?.(err?.message || String(err));
    return { updated: false, remoteVersion };
  }

  const needsUpdate =
    remoteVersion != null && isNewerVersion(remoteVersion, APP_VERSION);

  if (needsUpdate) {
    onStatus?.("updating");
    try {
      sessionStorage.setItem(UPDATED_FLAG, remoteVersion);
    } catch {
      /* ignore */
    }
  }

  try {
    await reg.update();
  } catch {
    /* offline or flaky network — keep running cached build */
  }

  // Waiting worker from a previous background download.
  if (reg.waiting) {
    onStatus?.("updating");
    activateWaiting(reg.waiting, remoteVersion);
    return { updated: true, remoteVersion: remoteVersion || APP_VERSION };
  }

  if (reg.installing) {
    onStatus?.("updating");
    const installed = await waitForInstalledWorker(reg);
    if (installed && navigator.serviceWorker.controller) {
      activateWaiting(installed, remoteVersion);
      return { updated: true, remoteVersion: remoteVersion || APP_VERSION };
    }
  }

  // Newer published version but SW byte-identical (shouldn't happen if CACHE bumps).
  // Force a one-shot reload so network-first shell + examples refresh.
  if (needsUpdate && navigator.serviceWorker.controller) {
    onStatus?.("updating");
    try {
      sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      /* ignore */
    }
    window.location.reload();
    return { updated: true, remoteVersion };
  }

  onStatus?.("current");
  return { updated: false, remoteVersion };
}

/**
 * Wire controllerchange → single reload, plus visibility refresh of SW.
 * @param {() => void} [onChecking]
 */
export function watchServiceWorkerLifecycle(onChecking) {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    onChecking?.();
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.update().catch(() => {});
    });
  });
}
