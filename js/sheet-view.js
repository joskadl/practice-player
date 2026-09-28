/**
 * OpenSheetMusicDisplay wrapper: MusicXML score, mute/solo colours,
 * playback cursor, auto-scroll, and zoom.
 */

import { channelColor } from "./piano-roll.js";

const MUTED_COLOR = "#b0b0b0";
const WIDTH_FALLBACK = 640;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.25;
const ZOOM_DEFAULT = 0.55;

function mixHex(a, b, t) {
  const parse = (hex) => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  };
  const ca = parse(a);
  const cb = parse(b);
  const m = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `#${[m(0), m(1), m(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function loadScriptOnce(src) {
  const existing = document.querySelector(`script[data-pp-src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.ppSrc = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function getOsmdCtor() {
  const g = globalThis.opensheetmusicdisplay || globalThis.OpenSheetMusicDisplay;
  if (!g) return null;
  return g.OpenSheetMusicDisplay || g;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fractionReal(f) {
  if (f == null) return 0;
  if (typeof f.RealValue === "number") return f.RealValue;
  if (typeof f.realValue === "number") return f.realValue;
  const n = f.Numerator ?? f.numerator ?? 0;
  const d = f.Denominator ?? f.denominator ?? 1;
  return d ? n / d : 0;
}

function iteratorEnded(it) {
  return !!(it?.endReached || it?.EndReached);
}

export class SheetView {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.osmd = null;
    this.xml = null;
    /** @type {{channel:number, voiceId:string}[]} */
    this.instrumentVoices = [];
    this._isVoiceAudible = () => true;
    this._voiceGain = (id) => (this._isVoiceAudible(id) ? 1 : 0);
    this._ready = false;
    this.ticksPerBeat = 480;
    this.zoom = ZOOM_DEFAULT;
    /** @type {{wn:number, tick:number}[]} */
    this._timeline = [];
    this._cursorIdx = 0;
    this._lastPlayheadTick = 0;
  }

  async ensure() {
    if (getOsmdCtor()) return;
    await loadScriptOnce("./vendor/opensheetmusicdisplay.min.js");
    if (!getOsmdCtor()) throw new Error("OpenSheetMusicDisplay failed to load");
  }

  clear() {
    this.xml = null;
    this.instrumentVoices = [];
    this._ready = false;
    this._timeline = [];
    this._cursorIdx = 0;
    this._lastPlayheadTick = 0;
    if (this.osmd) {
      try {
        this.osmd.clear();
      } catch {
        /* ignore */
      }
      this.osmd = null;
    }
    this.container.innerHTML = "";
  }

  getZoom() {
    return this.zoom;
  }

  /**
   * Make the host measurable for OSMD layout (hidden → clientWidth 0).
   * @returns {() => void}
   */
  _prepareLayoutSurface() {
    const el = this.container;
    const prevHidden = el.hidden;
    const prevVisibility = el.style.visibility;
    const prevPosition = el.style.position;
    const prevHeight = el.style.height;
    const prevOverflow = el.style.overflow;

    el.hidden = false;
    if (prevHidden) {
      el.style.visibility = "hidden";
      el.style.position = "absolute";
      el.style.height = "auto";
      el.style.overflow = "hidden";
      el.style.left = "0";
      el.style.right = "0";
      el.style.width = "100%";
    }

    return () => {
      if (prevHidden) {
        el.hidden = true;
        el.style.visibility = prevVisibility;
        el.style.position = prevPosition;
        el.style.height = prevHeight;
        el.style.overflow = prevOverflow;
        el.style.left = "";
        el.style.right = "";
        el.style.width = "";
      }
    };
  }

  async _waitForWidth() {
    for (let i = 0; i < 10; i++) {
      await nextFrame();
      if (this.container.clientWidth > 32) return this.container.clientWidth;
    }
    const parentW = this.container.parentElement?.clientWidth || 800;
    this.container.style.minWidth = `${Math.max(320, parentW)}px`;
    await nextFrame();
    return this.container.clientWidth;
  }

  _applyCursorStyle() {
    if (!this.osmd) return;
    try {
      // type 1 = thin vertical bar (playhead); color is baked into the cursor image
      this.osmd.cursorsOptions = [
        {
          type: 1,
          color: "#e63946",
          alpha: 0.75,
          follow: false,
        },
      ];
    } catch {
      /* ignore */
    }
  }

  _ensureCursorVisible() {
    const el = this.osmd?.cursor?.cursorElement;
    if (!el) return;
    el.style.zIndex = "20";
    el.style.pointerEvents = "none";
    if (this.osmd.cursor.wantedZIndex != null) this.osmd.cursor.wantedZIndex = 20;
  }

  _configurePageWidth(width) {
    try {
      this.osmd.setOptions({
        autoResize: true,
        pageFormat: "Endless",
      });
      if (this.osmd.EngravingRules && width > 0) {
        this.osmd.EngravingRules.PageWidth = Math.max(WIDTH_FALLBACK, width - 24);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {string} xmlText
   * @param {{
   *   voices: {id:string, channel:number, partId?:string}[],
   *   isVoiceAudible:(id:string)=>boolean,
   *   ticksPerBeat?: number,
   * }} opts
   */
  async load(xmlText, opts) {
    await this.ensure();
    this.clear();
    this.xml = xmlText;
    this._isVoiceAudible = opts.isVoiceAudible || (() => true);
    this._voiceGain =
      opts.voiceGain || ((id) => (this._isVoiceAudible(id) ? 1 : 0));
    this.ticksPerBeat = Math.max(1, opts.ticksPerBeat || 480);

    const restore = this._prepareLayoutSurface();
    try {
      const width = await this._waitForWidth();
      const Ctor = getOsmdCtor();
      this.osmd = new Ctor(this.container, {
        autoResize: true,
        backend: "svg",
        drawTitle: true,
        drawSubtitle: false,
        drawComposer: false,
        drawLyricist: false,
        drawCredits: false,
        drawPartNames: true,
        drawPartAbbreviations: true,
        drawingParameters: "default",
      });
      this._configurePageWidth(width);
      this._applyCursorStyle();

      await this.osmd.load(xmlText);
      this.osmd.zoom = this.zoom;
      this.osmd.render();
      this._mapInstruments(opts.voices || []);
      this.applyVoiceVisibility();
      this._buildTimeline();
      this._ready = true;
      this.setPlayhead(0, { scroll: false });
    } finally {
      restore();
    }
  }

  async revealAndRender() {
    if (!this.osmd || !this.xml) return;
    this.container.hidden = false;
    const width = await this._waitForWidth();
    this._configurePageWidth(width);
    this._applyCursorStyle();
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.applyVoiceVisibility();
    this._buildTimeline();
    this.setPlayhead(this._lastPlayheadTick, { scroll: true });
  }

  /**
   * @param {number} zoom
   * @param {{scroll?: boolean}} [opts]
   */
  async setZoom(zoom, opts = {}) {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || ZOOM_DEFAULT));
    if (!this.osmd || !this._ready) return this.zoom;
    const wasHidden = this.container.hidden;
    if (wasHidden) this.container.hidden = false;
    this._applyCursorStyle();
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.applyVoiceVisibility();
    this._buildTimeline();
    this.setPlayhead(this._lastPlayheadTick, { scroll: opts.scroll !== false });
    if (wasHidden) this.container.hidden = true;
    return this.zoom;
  }

  zoomBy(delta) {
    return this.setZoom(this.zoom + delta);
  }

  _buildTimeline() {
    this._timeline = [];
    this._cursorIdx = 0;
    const cursor = this.osmd?.cursor;
    if (!cursor) return;
    try {
      cursor.show();
      cursor.reset();
      let guard = 0;
      while (!iteratorEnded(cursor.iterator) && guard++ < 200000) {
        const wn = fractionReal(cursor.iterator.currentTimeStamp);
        this._timeline.push({
          wn,
          tick: Math.round(wn * this.ticksPerBeat * 4),
        });
        cursor.next();
      }
      cursor.reset();
      cursor.update();
      this._ensureCursorVisible();
    } catch {
      this._timeline = [];
    }
  }

  /**
   * Move OSMD cursor to the staff entry at/before ``tick`` and optionally scroll.
   * @param {number} tick
   * @param {{scroll?: boolean}} [opts]
   */
  setPlayhead(tick, opts = {}) {
    if (!this._ready || !this.osmd?.cursor) return;
    const scroll = opts.scroll !== false;
    this._lastPlayheadTick = tick | 0;
    const cursor = this.osmd.cursor;

    try {
      cursor.show();
    } catch {
      return;
    }

    if (!this._timeline.length) {
      this._buildTimeline();
    }
    if (!this._timeline.length) return;

    let idx = 0;
    for (let i = 0; i < this._timeline.length; i++) {
      if (this._timeline[i].tick <= this._lastPlayheadTick) idx = i;
      else break;
    }

    if (idx < this._cursorIdx) {
      cursor.reset();
      this._cursorIdx = 0;
    }
    while (this._cursorIdx < idx && !iteratorEnded(cursor.iterator)) {
      cursor.next();
      this._cursorIdx += 1;
    }
    try {
      cursor.update();
    } catch {
      /* ignore */
    }
    this._ensureCursorVisible();
    if (scroll) this._scrollCursorIntoView();
  }

  _scrollCursorIntoView() {
    const el = this.osmd?.cursor?.cursorElement;
    if (!el || this.container.hidden) return;
    const parent = this.container;
    const er = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (!er.width && !er.height && !er.left) return;

    const marginX = Math.max(40, pr.width * 0.22);
    const marginY = Math.max(40, pr.height * 0.28);
    let dx = 0;
    let dy = 0;
    if (er.left < pr.left + marginX) dx = er.left - pr.left - marginX;
    else if (er.right > pr.right - marginX) dx = er.right - pr.right + marginX;
    if (er.top < pr.top + marginY) dy = er.top - pr.top - marginY;
    else if (er.bottom > pr.bottom - marginY) dy = er.bottom - pr.bottom + marginY;
    if (dx) parent.scrollLeft += dx;
    if (dy) parent.scrollTop += dy;
  }

  _mapInstruments(voices) {
    this.instrumentVoices = [];
    const sheet = this.osmd?.Sheet;
    const instruments = sheet?.Instruments || [];
    for (let i = 0; i < instruments.length; i++) {
      const voice =
        voices[i] ||
        voices.find((v) => v.channel === i || v.channel === (i >= 9 ? i + 1 : i)) ||
        null;
      this.instrumentVoices.push(
        voice || {
          id: `ch:${i >= 9 ? i + 1 : i}`,
          channel: i >= 9 ? i + 1 : i,
        },
      );
    }
  }

  applyVoiceVisibility() {
    if (!this.osmd?.graphic) return;
    const graphic = this.osmd.graphic;
    const measureList = graphic.measureList || [];
    for (let staffIndex = 0; staffIndex < measureList.length; staffIndex++) {
      const staffMeasures = measureList[staffIndex] || [];
      for (const gMeasure of staffMeasures) {
        if (!gMeasure) continue;
        const staffEntries = gMeasure.staffEntries || [];
        for (const entry of staffEntries) {
          const gNotes = entry.graphicalVoiceEntries
            ? entry.graphicalVoiceEntries.flatMap((ve) => ve.notes || [])
            : entry.graphicalNotes || [];
          for (const gNote of gNotes) {
            this._colorGraphicalNote(gNote, staffIndex);
          }
        }
      }
    }
  }

  _voiceForStaffIndex(staffIndex) {
    if (this.instrumentVoices[staffIndex]) return this.instrumentVoices[staffIndex];
    return this.instrumentVoices[0] || { id: "ch:0", channel: 0 };
  }

  _instrumentIndexFromNote(gNote) {
    try {
      const src = gNote.sourceNote || gNote.getSourceNote?.();
      const staff = src?.ParentStaff || src?.parentStaff;
      const instr = staff?.ParentInstrument || staff?.parentInstrument;
      if (instr && this.osmd?.Sheet?.Instruments) {
        const idx = this.osmd.Sheet.Instruments.indexOf(instr);
        if (idx >= 0) return idx;
      }
      if (typeof instr?.Id === "number") return instr.Id;
      if (typeof instr?.id === "number") return instr.id;
    } catch {
      /* ignore */
    }
    return 0;
  }

  _colorGraphicalNote(gNote, staffIndexHint) {
    const instrIndex = this._instrumentIndexFromNote(gNote) ?? staffIndexHint;
    const voice = this.instrumentVoices[instrIndex] || this._voiceForStaffIndex(staffIndexHint);
    const gain =
      typeof this._voiceGain === "function"
        ? this._voiceGain(voice.id)
        : this._isVoiceAudible(voice.id)
          ? 1
          : 0;
    let color = MUTED_COLOR;
    if (gain > 0) {
      const base = channelColor(voice.channel ?? 0);
      color = gain >= 0.95 ? base : mixHex(base, MUTED_COLOR, 1 - gain);
    }
    try {
      if (typeof gNote.setColor === "function") gNote.setColor(color);
    } catch {
      /* ignore */
    }
    try {
      const el = gNote.getSVGGElement?.() || gNote.svggElement;
      if (el) {
        el.querySelectorAll("path, polygon, rect, ellipse, circle, text").forEach((node) => {
          node.setAttribute("fill", color);
          if (node.getAttribute("stroke") && node.getAttribute("stroke") !== "none") {
            node.setAttribute("stroke", color);
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  hasScore() {
    return this._ready && !!this.xml;
  }
}

export { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT };
