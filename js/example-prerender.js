/**
 * Idle prefetch + OSMD pre-render for example scores so switching feels snappy.
 *
 * - Parses all catalog examples into memory.
 * - Pre-renders OSMD for a size-capped “reasonable set” into offscreen hosts.
 * - `takeRendered` hands a ready SheetView to the live sheet for instant adopt.
 */

import { fetchExampleAsMusicXml } from "./score-import.js";
import { parseMusicXml } from "./musicxml-parse.js";
import { stripPersonalNames, ensureKeyMetadata } from "./musicxml-edit.js";
import { SheetView } from "./sheet-view.js";

/** Skip OSMD pre-render above this MusicXML size (still prefetch+parse). */
const MAX_PRERENDER_XML_CHARS = 220_000;
/** Cap how many full SVG pre-renders we keep (smallest-first). */
const MAX_PRERENDER_SLOTS = 5;
const WIDTH_TOLERANCE_PX = 40;
const ZOOM_TOLERANCE = 0.04;

function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 120 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function exampleKey(ex) {
  return String(ex?.id || ex?.file || "").replace(/^\/+/, "");
}

export class ExamplePrerenderCache {
  /**
   * @param {{
   *   getLayoutWidth: () => number,
   *   getZoom: () => number,
   * }} opts
   */
  constructor(opts) {
    this.getLayoutWidth = opts.getLayoutWidth;
    this.getZoom = opts.getZoom;
    /** @type {Map<string, {key:string, file:string, title:string, xml:string, parsed:object}>} */
    this.parsed = new Map();
    /** @type {Map<string, {key:string, view:SheetView, slot:HTMLElement, width:number, zoom:number, data:object}>} */
    this.rendered = new Map();
    /** @type {HTMLElement|null} */
    this._root = null;
    this._warming = false;
    this._generation = 0;
    /** @type {object[]|null} */
    this._catalog = null;
  }

  _ensureRoot() {
    if (this._root?.isConnected) return this._root;
    const root = document.createElement("div");
    root.id = "examplePrerenderRoot";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText =
      "position:fixed;left:-12000px;top:0;width:800px;visibility:hidden;"
      + "pointer-events:none;overflow:hidden;contain:strict;";
    document.body.appendChild(root);
    this._root = root;
    return root;
  }

  /**
   * @param {object} ex manifest entry
   */
  async ensureParsed(ex) {
    const key = exampleKey(ex);
    if (!key) throw new Error("Missing example id");
    const hit = this.parsed.get(key);
    if (hit) return hit;

    const file = String(ex.file || "").replace(/^\/+/, "");
    let xml = await fetchExampleAsMusicXml(file, { preferCache: true });
    xml = stripPersonalNames(xml);
    try {
      xml = ensureKeyMetadata(xml);
    } catch {
      /* keep */
    }
    const parsed = parseMusicXml(xml);
    const entry = {
      key,
      file,
      title: ex.title || file,
      xml,
      parsed,
    };
    this.parsed.set(key, entry);
    return entry;
  }

  /**
   * @param {string|object} exOrKey
   */
  getParsed(exOrKey) {
    const key = typeof exOrKey === "string" ? exOrKey : exampleKey(exOrKey);
    return this.parsed.get(key) || null;
  }

  _disposeRendered(key) {
    const entry = this.rendered.get(key);
    if (!entry) return;
    this.rendered.delete(key);
    try {
      entry.view.clear();
    } catch {
      /* ignore */
    }
    entry.slot?.remove();
  }

  invalidateRendered() {
    for (const key of [...this.rendered.keys()]) {
      this._disposeRendered(key);
    }
    this._generation += 1;
  }

  /**
   * Drop a rendered entry and return it for adoption (caller owns the SheetView).
   * @param {object} ex
   * @param {{width:number, zoom:number}} layout
   */
  takeRendered(ex, layout) {
    const key = exampleKey(ex);
    const entry = this.rendered.get(key);
    if (!entry) return null;
    const width = layout?.width || 0;
    const zoom = layout?.zoom ?? this.getZoom();
    if (width > 0 && Math.abs(entry.width - width) > WIDTH_TOLERANCE_PX) return null;
    if (Math.abs(entry.zoom - zoom) > ZOOM_TOLERANCE) return null;
    this.rendered.delete(key);
    return entry;
  }

  /**
   * @param {object} ex
   * @param {number} generation
   */
  async _prerenderOne(ex, generation) {
    const key = exampleKey(ex);
    const data = await this.ensureParsed(ex);
    if (generation !== this._generation) return null;

    if ((data.xml?.length || 0) > MAX_PRERENDER_XML_CHARS) {
      return null;
    }
    if (this.rendered.size >= MAX_PRERENDER_SLOTS && !this.rendered.has(key)) {
      return null;
    }

    const width = Math.max(280, this.getLayoutWidth() || 480);
    const zoom = this.getZoom();
    const existing = this.rendered.get(key);
    if (
      existing
      && Math.abs(existing.width - width) <= WIDTH_TOLERANCE_PX
      && Math.abs(existing.zoom - zoom) <= ZOOM_TOLERANCE
    ) {
      return existing;
    }
    this._disposeRendered(key);

    const root = this._ensureRoot();
    root.style.width = `${width}px`;
    const slot = document.createElement("div");
    slot.className = "example-prerender-slot sheet-music";
    slot.dataset.exampleKey = key;
    slot.style.cssText = `width:${width}px;height:auto;overflow:hidden;`;
    root.appendChild(slot);

    const view = new SheetView(slot);
    view.zoom = zoom;
    await view.load(data.xml, {
      voices: data.parsed.voices || [],
      isVoiceAudible: () => true,
      voiceGain: () => 1,
      isVoiceVisible: () => true,
      ticksPerBeat: data.parsed.ticksPerBeat || 480,
      onsetTicks: data.parsed.onsetTicks || [],
      playheadTick: 0,
    });
    if (generation !== this._generation) {
      try {
        view.clear();
      } catch {
        /* ignore */
      }
      slot.remove();
      return null;
    }

    const entry = { key, view, slot, width, zoom, data };
    this.rendered.set(key, entry);
    return entry;
  }

  /**
   * Prefetch/parse all examples; OSMD-pre-render the smallest ones up to the slot cap.
   * @param {object[]} examples
   */
  async warm(examples) {
    if (!Array.isArray(examples) || !examples.length) return;
    if (this._warming) {
      this._catalog = examples;
      return;
    }
    this._warming = true;
    this._catalog = examples;
    const generation = this._generation;
    try {
      // Parse everything first (enables snappy apply even for large scores).
      for (const ex of examples) {
        if (generation !== this._generation) break;
        try {
          await this.ensureParsed(ex);
        } catch (err) {
          console.warn("[example-prerender] parse failed", exampleKey(ex), err);
        }
        await yieldToMain();
      }

      // Smallest MusicXML first for OSMD slots.
      const ranked = examples
        .map((ex) => {
          const key = exampleKey(ex);
          const data = this.parsed.get(key);
          return { ex, key, len: data?.xml?.length || Number.MAX_SAFE_INTEGER };
        })
        .filter((x) => x.len <= MAX_PRERENDER_XML_CHARS)
        .sort((a, b) => a.len - b.len)
        .slice(0, MAX_PRERENDER_SLOTS);

      for (const { ex } of ranked) {
        if (generation !== this._generation) break;
        try {
          await this._prerenderOne(ex, generation);
        } catch (err) {
          console.warn("[example-prerender] render failed", exampleKey(ex), err);
        }
        await yieldToMain();
      }
    } finally {
      this._warming = false;
      // If catalog/zoom changed mid-warm, run again.
      if (this._generation !== generation && this._catalog) {
        void this.warm(this._catalog);
      }
    }
  }

  /** Re-warm after zoom/resize invalidation (idle). */
  scheduleRewarm() {
    this.invalidateRendered();
    const catalog = this._catalog;
    if (!catalog?.length) return;
    const run = () => {
      void this.warm(catalog);
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 500);
    }
  }

  /** Re-queue a single example after it was consumed by adopt. */
  scheduleOne(ex) {
    const catalog = this._catalog;
    const run = () => {
      void (async () => {
        try {
          await this._prerenderOne(ex, this._generation);
        } catch {
          /* ignore */
        }
        // If slots freed and catalog has more small scores, fill in.
        if (catalog?.length) void this.warm(catalog);
      })();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 400);
    }
  }
}
