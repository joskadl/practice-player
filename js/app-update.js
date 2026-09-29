/**
 * Startup / foreground update check for the installed PWA.
 *
 * Shows an Update banner when published version.json is newer than the
 * running build. "Update now" unregisters the service worker, clears
 * caches, and does a cache-busted navigation so the next load cannot
 * keep serving a stale shell (which caused an update-prompt loop).
 */

import { APP_VERSION } from "./version.js";

const VERSION_URL = "./version.json";
const RELOAD_FLAG = "mpp-sw-reloading";
const UPDATED_FLAG = "mpp-just-updated";
const DISMISS_FLAG = "mpp-update-dismissed";
const APPLIED_FLAG = "mpp-applied-version";

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
 * Drop the one-shot cache-buster query param from the address bar.
 */
export function scrubUpdateQueryParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("mpp_v")) return;
    url.searchParams.delete("mpp_v");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next || url.pathname);
  } catch {
    /* ignore */
  }
}

/**
 * Label for the post-update status line.
 * Prefers the version that is actually running once it matches (or exceeds)
 * the target we applied — never report the pre-update shell version as success.
 *
 * @returns {string|null}
 */
export function consumeJustUpdatedLabel() {
  try {
    const reloading = sessionStorage.getItem(RELOAD_FLAG) === "1";
    if (reloading) sessionStorage.removeItem(RELOAD_FLAG);

    const target =
      sessionStorage.getItem(APPLIED_FLAG) ||
      sessionStorage.getItem(UPDATED_FLAG) ||
      null;

    if (!reloading && !target) return null;

    // Still on an older shell after Update now — don't claim success yet.
    if (target && compareSemver(APP_VERSION, target) < 0) {
      return null;
    }

    sessionStorage.removeItem(UPDATED_FLAG);
    sessionStorage.removeItem(APPLIED_FLAG);
    // Announce the build that is actually running.
    return formatVersionLabel(APP_VERSION);
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
 * @param {number} [timeoutMs]
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
 * Hard reset: unregister SW, wipe caches, cache-bust navigate.
 * Avoids the loop where reload kept serving a stale shell while
 * version.json already advertised a newer release.
 *
 * @param {{ remoteVersion?: string|null }} [opts]
 */
export async function applyAppUpdate(opts = {}) {
  const remoteVersion = opts.remoteVersion || null;

  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
    const target = remoteVersion || APP_VERSION;
    sessionStorage.setItem(UPDATED_FLAG, target);
    sessionStorage.setItem(APPLIED_FLAG, target);
    sessionStorage.removeItem(DISMISS_FLAG);
  } catch {
    /* ignore */
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }

  const url = new URL(window.location.href);
  url.searchParams.set("mpp_v", String(Date.now()));
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
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

  // Already running the published (or newer) build — never prompt.
  if (remoteVersion != null && compareSemver(remoteVersion, APP_VERSION) <= 0) {
    try {
      sessionStorage.removeItem(APPLIED_FLAG);
    } catch {
      /* ignore */
    }
    try {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      else if (!navigator.serviceWorker.controller) {
        const worker = reg.installing ? await waitForInstalledWorker(reg) : null;
        if (worker) worker.postMessage({ type: "SKIP_WAITING" });
      }
    } catch {
      /* ignore */
    }
    onStatus?.("current");
    return { available: false, remoteVersion, registration: reg };
  }

  // Just applied this remote version but shell still looks old — avoid re-prompt spam this session.
  try {
    const applied = sessionStorage.getItem(APPLIED_FLAG);
    if (
      applied &&
      remoteVersion &&
      applied === remoteVersion &&
      compareSemver(remoteVersion, APP_VERSION) > 0
    ) {
      onStatus?.("current");
      return { available: false, remoteVersion, registration: reg };
    }
  } catch {
    /* ignore */
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

  // Prompt only when the published version is actually newer.
  const available =
    remoteVersion != null && isNewerVersion(remoteVersion, APP_VERSION);

  if (available && !wasDismissedFor(remoteVersion)) {
    onAvailable?.({ remoteVersion, registration: reg });
  } else {
    onStatus?.("current");
  }

  return { available, remoteVersion, registration: reg };
}

/**
 * Background SW refresh when the app becomes visible again.
 * No automatic reload — updates go through the banner + Update now.
 *
 * @param {{ onVisibleCheck?: () => void }} opts
 */
export function watchServiceWorkerLifecycle(opts) {
  if (!("serviceWorker" in navigator)) return;
  const { onVisibleCheck } = opts;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    onVisibleCheck?.();
  });
}
