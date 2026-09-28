/**
 * Offline shell for MIDI Practice Player (GitHub Pages / PWA).
 * After the first online visit, the app (including the soundfont) is cached.
 */

const CACHE = "midi-practice-player-v16";

const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/main.js",
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
  "./examples/demo.mid",
  "./examples/stille-nacht.musicxml",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === "opaque") {
            return response;
          }
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
