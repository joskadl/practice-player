/**
 * Score file import: MusicXML / compressed .mxl / MuseScore .mscz → MusicXML text.
 *
 * .mxl is unzipped with vendored fflate (MIT).
 * .mscz is converted via LibreScore webmscore (GPL-3.0), lazy-loaded from CDN
 * on first use so the app shell stays small.
 */

import { unzipSync } from "../vendor/fflate.js";
import { SHARED_MISC_FIELDS, upsertMiscFieldsInMusicXml } from "./score-meta.js";

const WEBMSSCORE_CDN =
  "https://cdn.jsdelivr.net/npm/webmscore@1.2.1/webmscore.cdn.mjs";

/** @type {Promise<any>|null} */
let webmscoreReady = null;

export function isScoreXmlName(name) {
  const n = String(name || "").toLowerCase();
  return (
    n.endsWith(".musicxml")
    || n.endsWith(".xml")
    || n.endsWith(".mxl")
    || n.endsWith(".mscz")
    || n.endsWith(".mscx")
  );
}

export function isMuseScoreName(name) {
  const n = String(name || "").toLowerCase();
  return n.endsWith(".mscz") || n.endsWith(".mscx");
}

export function isCompressedMusicXmlName(name) {
  return String(name || "").toLowerCase().endsWith(".mxl");
}

/**
 * Sibling deploy artifact for a MuseScore example (fast path / offline).
 * @param {string} file
 */
export function musicXmlSiblingName(file) {
  return String(file || "").replace(/\.(mscz|mscx)$/i, ".musicxml");
}

async function ensureWebMscore() {
  if (!webmscoreReady) {
    webmscoreReady = import(/* @vite-ignore */ WEBMSSCORE_CDN)
      .then((mod) => {
        const WebMscore = mod.default || mod.WebMscore || mod;
        return WebMscore.ready.then(() => WebMscore);
      })
      .catch((err) => {
        webmscoreReady = null;
        throw new Error(
          `Could not load MuseScore converter (webmscore). `
          + `Check your network connection. (${err?.message || err})`,
        );
      });
  }
  return webmscoreReady;
}

/**
 * @param {Uint8Array} bytes
 * @param {"mscz"|"mscx"|"musicxml"|"mxl"} format
 */
async function convertWithWebMscore(bytes, format) {
  const WebMscore = await ensureWebMscore();
  const score = await WebMscore.load(format, bytes, [], /* doLayout */ false);
  try {
    const xml = String(await score.saveXml() || "");
    if (!xml.includes("<score-partwise") && !xml.includes("<score-timewise")) {
      throw new Error("MuseScore conversion produced empty MusicXML");
    }
    return xml;
  } finally {
    try {
      score.destroy?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {Uint8Array} bytes
 */
export function musicXmlFromMxl(bytes) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch (err) {
    throw new Error(`Invalid compressed MusicXML (.mxl): ${err?.message || err}`);
  }

  const names = Object.keys(files);
  const containerName = names.find((n) => /META-INF\/container\.xml$/i.test(n));
  if (containerName) {
    const containerXml = new TextDecoder().decode(files[containerName]);
    const fullPath = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
    if (fullPath) {
      const key = names.find((n) => n.replace(/\\/g, "/") === fullPath.replace(/\\/g, "/"))
        || names.find((n) => n.endsWith(fullPath.replace(/^.*\//, "")));
      if (key && files[key]) {
        return new TextDecoder().decode(files[key]);
      }
    }
  }

  const scoreName =
    names.find((n) => /score\.(musicxml|xml)$/i.test(n))
    || names.find((n) => /\.musicxml$/i.test(n))
    || names.find((n) => /(^|\/)[^/]+\.xml$/i.test(n) && !/META-INF\//i.test(n));
  if (!scoreName) {
    throw new Error("No MusicXML score found inside .mxl archive");
  }
  return new TextDecoder().decode(files[scoreName]);
}

/**
 * Read MuseScore Project Properties metaTags that map to shared MusicXML misc fields.
 * @param {Uint8Array} bytes
 * @param {string} [fileName]
 * @returns {Record<string, string>}
 */
export function metaTagsFromMscz(bytes, fileName = "score.mscz") {
  const lower = String(fileName).toLowerCase();
  let mscxText = "";
  if (lower.endsWith(".mscx")) {
    mscxText = new TextDecoder().decode(bytes);
  } else {
    let files;
    try {
      files = unzipSync(bytes);
    } catch {
      return {};
    }
    const key = Object.keys(files).find((n) => /\.mscx$/i.test(n));
    if (!key) return {};
    mscxText = new TextDecoder().decode(files[key]);
  }
  /** @type {Record<string, string>} */
  const out = {};
  const wanted = new Set(SHARED_MISC_FIELDS);
  const re = /<metaTag\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/metaTag>/g;
  let m;
  while ((m = re.exec(mscxText))) {
    const name = m[1];
    if (!wanted.has(name)) continue;
    const text = m[2]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#10;/g, "\n")
      .trim();
    if (text) out[name] = text;
  }
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @param {string} [fileName]
 */
export async function musicXmlFromMscz(bytes, fileName = "score.mscz") {
  const lower = String(fileName).toLowerCase();
  const format = lower.endsWith(".mscx") ? "mscx" : "mscz";
  const meta = metaTagsFromMscz(bytes, fileName);
  const xml = await convertWithWebMscore(bytes, format);
  // MuseScore stores JI/remarks as metaTags; ensure they survive conversion.
  return upsertMiscFieldsInMusicXml(xml, meta, { onlyMissing: true });
}

/**
 * Read a File / Blob into MusicXML text.
 * @param {Blob & {name?: string}} file
 * @param {{onProgress?: (msg: string) => void}} [opts]
 */
export async function readScoreFileAsMusicXml(file, opts = {}) {
  const name = file.name || "score.musicxml";
  const lower = name.toLowerCase();

  if (lower.endsWith(".mxl")) {
    opts.onProgress?.("Unpacking MusicXML…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return musicXmlFromMxl(bytes);
  }

  if (lower.endsWith(".mscz") || lower.endsWith(".mscx")) {
    opts.onProgress?.("Converting MuseScore file…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return musicXmlFromMscz(bytes, name);
  }

  // Plain MusicXML / XML
  return file.text();
}

/**
 * Fetch an example path (relative URL) as MusicXML text.
 * For .mscz examples, loads the sibling .musicxml deploy artifact (from
 * `npm run examples:build`). Falls back to in-browser webmscore only if that
 * cache is missing — unreliable for MuseScore 4 scores.
 * @param {string} file relative name under examples/
 * @param {{onProgress?: (msg: string) => void}} [opts]
 */
export async function fetchExampleAsMusicXml(file, opts = {}) {
  const name = String(file || "").replace(/^\/+/, "");
  if (!name) throw new Error("Missing example file");

  if (/\.(mscz|mscx)$/i.test(name)) {
    const sibling = musicXmlSiblingName(name);
    try {
      opts.onProgress?.("Loading score…");
      const cached = await fetch(`./examples/${sibling}`, { cache: "no-store" });
      if (cached.ok) {
        const text = await cached.text();
        if (
          (text.includes("<score-partwise") || text.includes("<score-timewise"))
          && /<note[\s>]/.test(text)
        ) {
          return text;
        }
      }
    } catch {
      /* fall through to live conversion */
    }

    opts.onProgress?.("Converting MuseScore file…");
    const res = await fetch(`./examples/${name}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load ${name}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return musicXmlFromMscz(bytes, name);
  }

  if (/\.mxl$/i.test(name)) {
    opts.onProgress?.("Unpacking MusicXML…");
    const res = await fetch(`./examples/${name}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load ${name}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return musicXmlFromMxl(bytes);
  }

  const res = await fetch(`./examples/${name}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${name}`);
  return res.text();
}
