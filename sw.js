/**
 * Offline shell for MIDI Practice Player (GitHub Pages / PWA).
 *
 * App shell (HTML/JS/CSS) and examples are network-first so a normal
 * reload / startup update picks up deploys. Heavy vendor/soundfont
 * assets stay cache-first. Precache keeps the last good copy for offline.
 */

const CACHE = "midi-practice-player-v42";

const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./version.json",
  "./js/main.js",
  "./js/i18n.js",
  "./js/midi-parse.js",
  "./js/musicxml-parse.js",
  "./js/musicxml-edit.js",
  "./js/musicxml-annotate.js",
  "./js/sheet-pdf-export.js",
  "./js/ji-retune.js",
  "./js/transport.js",
  "./js/synth.js",
  "./js/piano-roll.js",
  "./js/sheet-view.js",
  "./js/version.js",
  "./js/app-update.js",
  "./js/practice-pack.js",
  "./js/local-store.js",
  "./js/sync-remote.js",
  "./js/project-session.js",
  "./vendor/libfluidsynth-2.4.6.js",
  "./vendor/js-synthesizer.min.js",
  "./vendor/js-synthesizer.worklet.min.js",
  "./vendor/opensheetmusicdisplay.min.js",
  "./soundfonts/TimGM6mb.sf2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./examples/manifest.json",
  "./examples/stille-nacht.musicxml",
  "./examples/blue-christmas-for-barbershopers.musicxml",
  "./examples/gaudete-christus-est-natus.musicxml",
  "./examples/gloria-in-excelsis-deo-oggi-e-nato-il-salvatore.musicxml",
  "./examples/please-come-home-for-christmas.musicxml",
  "./examples/entre-le-boeuf-et-lane-gris.musicxml",
];

/** True for files that must prefer the network (app code / examples / version). */
function isNetworkFirst(url) {
  const path = url.pathname;
  if (path.endsWith("/") || path.endsWith("/index.html")) return true;
  if (path.endsWith(".html") || path.endsWith(".css") || path.endsWith(".js")) return true;
  if (path.endsWith(".webmanifest") || path.endsWith("manifest.webmanifest")) return true;
  if (path.endsWith("/version.json") || path.endsWith("version.json")) return true;
  if (path.includes("/examples/")) return true;
  // Never cache the service worker script itself via this handler.
  if (path.endsWith("/sw.js")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  // Precache the new build, but stay in "waiting" until the page sends
  // SKIP_WAITING (Update now / first install). Avoids silent half-updates.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    // Bypass HTTP cache so Update now / startup checks cannot keep a stale shell.
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (await caches.match("./index.html")) || Response.error();
    }
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.status === 200 && response.type !== "opaque") {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match("./index.html")) || Response.error();
  }
}
