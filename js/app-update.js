/**
 * Startup / foreground update check for the installed PWA.
 *
 * Detects a newer published version (version.json) or a waiting service
 * worker, then surfaces a prompt. Applying the update is user-driven
 * (Update now) so installs are never silently half-refreshed.
 */

import { APP_VERSION } from "./version.js";

const VERSION_URL = "./version.json";
const RELOAD_FLAG = "mpp-sw-reloading";
const UPDATED_FLAG = "mpp-just-updated";
const DISMISS_FLAG = "mpp-update-dismissed";

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
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

export function formatVersionLabel(v) {
  if (!v) return "";
  return v.startsWith("v") ? v : `v${v}`;
}

/**
 * @returns {string|null}
 */
export function consumeJustUpdatedLabel() {
  try {
    const v = sessionStorage.getItem(UPDATED_FLAG);
    if (!v) return null;
    sessionStorage.removeItem(UPDATED_FLAG);
    return formatVersionLabel(v);
  } catch {
    return null;
  }
}

function wasDismissedFor(remoteVersion) {
  try {
    return sessionStorage.getItem(DISMISS_FLAG) === String(remoteVersion || "");
  } catch {
    return false;
  }
}

export function dismissUpdatePrompt(remoteVersion) {
  try {
    sessionStorage.setItem(DISMISS_FLAG, String(remoteVersion || "1"));
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Promise<string|null>}
 */
export async function fetchPublishedVersion() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const v = data?.version;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * @param {ServiceWorkerRegistration} reg
 * @returns {Promise<ServiceWorker|null>}
 */
function waitForInstalledWorker(reg, timeoutMs = 20000) {
  const installing = reg.installing;
  if (!installing) return Promise.resolve(reg.waiting || null);
  return new Promise((resolve) => {
    const done = (worker) => {
      clearTimeout(timer);
      resolve(worker);
    };
    const timer = setTimeout(() => done(reg.waiting || null), timeoutMs);
    if (installing.state === "installed") {
      done(installing);
      return;
    }
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") done(installing);
      if (installing.state === "redundant") done(reg.waiting || null);
    });
  });
}

/**
 * Activate waiting SW (if any), wipe old caches, reload.
 * @param {{ registration?: ServiceWorkerRegistration|null, remoteVersion?: string|null }} [opts]
 */
export async function applyAppUpdate(opts = {}) {
  const remoteVersion = opts.remoteVersion || null;
  let reg = opts.registration || null;

  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
    sessionStorage.setItem(UPDATED_FLAG, remoteVersion || APP_VERSION);
    sessionStorage.removeItem(DISMISS_FLAG);
  } catch {
    /* ignore */
  }

  try {
    if (!reg && "serviceWorker" in navigator) {
      reg = await navigator.serviceWorker.getRegistration();
    }
    if (reg) {
      try {
        await reg.update();
      } catch {
        /* ignore */
      }
      let worker = reg.waiting;
      if (!worker && reg.installing) {
        worker = await waitForInstalledWorker(reg);
      }
      if (worker) {
        worker.postMessage({ type: "SKIP_WAITING" });
        // controllerchange handler reloads; fallback below if it does not.
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  } catch {
    /* fall through to cache wipe + reload */
  }

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }

  window.location.reload();
}

/**
 * @param {{
 *   onAvailable?: (info: { remoteVersion: string|null, registration: ServiceWorkerRegistration|null }) => void,
 *   onStatus?: (phase: string) => void,
 *   onError?: (msg: string) => void,
 * }} [opts]
 * @returns {Promise<{ available: boolean, remoteVersion: string|null, registration: ServiceWorkerRegistration|null }>}
 */
export async function checkForAppUpdate(opts = {}) {
  const { onAvailable, onStatus, onError } = opts;

  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") {
      sessionStorage.removeItem(RELOAD_FLAG);
      sessionStorage.setItem(UPDATED_FLAG, APP_VERSION);
    }
  } catch {
    /* ignore */
  }

  if (!("serviceWorker" in navigator)) {
    return { available: false, remoteVersion: null, registration: null };
  }

  let remoteVersion = null;
  try {
    onStatus?.("checking");
    remoteVersion = await fetchPublishedVersion();
  } catch {
    remoteVersion = null;
  }

  let reg = null;
  try {
    reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  } catch (err) {
    onError?.(err?.message || String(err));
    return { available: false, remoteVersion, registration: null };
  }

  // First install: take control without prompting.
  if (!navigator.serviceWorker.controller) {
    try {
      await reg.update();
    } catch {
      /* ignore */
    }
    const worker = reg.waiting || (await waitForInstalledWorker(reg));
    if (worker) worker.postMessage({ type: "SKIP_WAITING" });
    onStatus?.("current");
    return { available: false, remoteVersion, registration: reg };
  }

  try {
    await reg.update();
  } catch {
    /* offline */
  }

  if (reg.installing) {
    await waitForInstalledWorker(reg);
  }

  const waiting = !!(reg.waiting || reg.installing);
  const newer =
    remoteVersion != null && isNewerVersion(remoteVersion, APP_VERSION);
  const available = waiting || newer;

  if (available && !wasDismissedFor(remoteVersion || "waiting")) {
    onAvailable?.({ remoteVersion, registration: reg });
  } else {
    onStatus?.("current");
  }

  return { available, remoteVersion, registration: reg };
}

/**
 * Reload only after the user chose Update now (SKIP_WAITING).
 * Still refresh the SW in the background when the app becomes visible.
 *
 * @param {{
 *   userInitiatedRef: { current: boolean },
 *   onVisibleCheck?: () => void,
 *   onUpdateFound?: (reg: ServiceWorkerRegistration) => void,
 * }} opts
 */
export function watchServiceWorkerLifecycle(opts) {
  if (!("serviceWorker" in navigator)) return;
  const { userInitiatedRef, onVisibleCheck, onUpdateFound } = opts;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!userInitiatedRef?.current) return;
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          onUpdateFound?.(reg);
        }
      });
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    onVisibleCheck?.();
  });
}
