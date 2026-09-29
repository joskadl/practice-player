/**
 * OpenSheetMusicDisplay wrapper: MusicXML score, mute/solo colours,
 * playback cursor, auto-scroll, zoom, and inline title/part editing.
 */

import { channelColor } from "./piano-roll.js";
import { readMusicXmlMeta, applyMusicXmlEdits } from "./musicxml-edit.js";
import {
  DEFAULT_LAYERS,
  PRACTICE_NOTE_COLOR,
  readAnnotationLayers,
  writeAnnotationLayers,
  insertHarmonyAtTick,
  insertDirectionWordsAtTick,
  updateAnnotationAtTick,
  removeAnnotationAtTick,
} from "./musicxml-annotate.js";
import { exportSheetViewPdf } from "./sheet-pdf-export.js";

const MUTED_COLOR = "#b0b0b0";
const WIDTH_FALLBACK = 640;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.25;
const ZOOM_DEFAULT = 0.55;
/** Pixel gap between cursor bar and leftmost notehead under the cursor. */
const CURSOR_HEAD_GAP_PX = 3;
/** Max click distance (px) from a notehead to count as a seek target. */
const SEEK_HIT_MAX_PX = 72;

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
    this._isVoiceVisible = () => true;
    this._ready = false;
    this.ticksPerBeat = 480;
    this.zoom = ZOOM_DEFAULT;
    /** @type {{wn:number, tick:number, x:number|null}[]} */
    this._timeline = [];
    /** @type {number[]} */
    this._onsetTicks = [];
    this._cursorIdx = 0;
    this._lastPlayheadTick = 0;
    this.showStaffLines = true;
    /** @type {{ title: string, parts: Map<string,string>, staffLines: number, colors: Map<string,string> }|null} */
    this._pending = null;
    this.dirty = false;
    /** @type {((dirty:boolean)=>void)|null} */
    this.onDirtyChange = null;
    /** @type {((partId:string, name:string)=>void)|null} */
    this.onPartRename = null;
    /** @type {((tick:number)=>void)|null} */
    this.onSeek = null;
    /** @type {((xml:string, label:string)=>void|Promise<void>)|null} */
    this.onXmlMutated = null;
    /** @type {((layers:object)=>void)|null} */
    this.onLayersChange = null;
    /** @type {((mode:string|null)=>void)|null} */
    this.onAnnotModeChange = null;
    /** @type {((voice:{id:string,channel?:number,partId?:string})=>string)|null} */
    this.voiceColor = null;
    this._editInput = null;
    this._editCtx = null;
    /** @type {HTMLInputElement|null} */
    this._annotInput = null;
    /** @type {{kind:"chord"|"note", tick:number}|null} */
    this._annotCtx = null;
    /** @type {{staves:boolean, lyrics:boolean, chords:boolean, notes:boolean}} */
    this.layers = { ...DEFAULT_LAYERS };
    /** @type {null|"chord"|"note"} */
    this.annotMode = null;
    /** Cached EngravingRules values to restore when staves layer is re-enabled. */
    this._engravingDefaults = null;
    /** When false, user scrolled away — auto-follow resumes once the cursor re-enters view. */
    this._followScroll = true;
    /** Tallest system height — playhead bar uses this length score-wide. */
    this._maxCursorHeight = 0;
    /** Ignore scroll events until this time (ms) after a programmatic scroll. */
    this._ignoreScrollUntil = 0;
    this._lastScrollLeft = 0;
    this._lastScrollTop = 0;
    this._onUserScroll = () => {
      if (performance.now() < this._ignoreScrollUntil) {
        this._lastScrollLeft = this.container.scrollLeft;
        this._lastScrollTop = this.container.scrollTop;
        return;
      }
      const dx = Math.abs(this.container.scrollLeft - this._lastScrollLeft);
      const dy = Math.abs(this.container.scrollTop - this._lastScrollTop);
      this._lastScrollLeft = this.container.scrollLeft;
      this._lastScrollTop = this.container.scrollTop;
      // Ignore sub-pixel / layout jitter; only real user pans disable follow.
      if (dx < 2 && dy < 2) return;
      this._followScroll = false;
    };
    this.container.addEventListener("scroll", this._onUserScroll, { passive: true });
    this.container.addEventListener("click", (ev) => this._onContainerClick(ev));
  }

  async ensure() {
    if (getOsmdCtor()) return;
    await loadScriptOnce("./vendor/opensheetmusicdisplay.min.js");
    if (!getOsmdCtor()) throw new Error("OpenSheetMusicDisplay failed to load");
  }

  clear() {
    this._cancelInlineEdit();
    this._cancelAnnotInput();
    this.xml = null;
    this.instrumentVoices = [];
    this._ready = false;
    this._timeline = [];
    this._onsetTicks = [];
    this._cursorIdx = 0;
    this._lastPlayheadTick = 0;
    this._pending = null;
    this._svgLayoutBackup = null;
    this.annotMode = null;
    /** Tallest system height seen — playhead bar stays this long so follow Y is stable. */
    this._maxCursorHeight = 0;
    this._setDirty(false);
    this.container.classList.remove(
      "pp-hide-staves",
      "pp-hide-lyrics",
      "pp-hide-chords",
      "pp-hide-notes",
      "pp-annot-chord",
      "pp-annot-note",
    );
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

  _setDirty(dirty) {
    const next = !!dirty;
    if (this.dirty === next) return;
    this.dirty = next;
    if (typeof this.onDirtyChange === "function") this.onDirtyChange(this.dirty);
  }

  _ensurePending() {
    if (this._pending) return this._pending;
    let meta;
    try {
      meta = readMusicXmlMeta(this.xml || "");
    } catch {
      meta = { title: "", parts: [], staffLines: this.showStaffLines ? 5 : 0 };
    }
    this._pending = {
      title: meta.title || "",
      parts: new Map(meta.parts.map((p) => [p.id, p.name])),
      staffLines: this.showStaffLines ? 5 : 0,
      colors: new Map(Object.entries(meta.voiceColors || {})),
    };
    return this._pending;
  }

  /**
   * Current edits as MusicXML patch fields (for export).
   */
  getEdits() {
    const p = this._ensurePending();
    return {
      title: p.title,
      parts: [...p.parts.entries()].map(([id, name]) => ({ id, name })),
      staffLines: p.staffLines,
      voiceColors: Object.fromEntries(p.colors.entries()),
    };
  }

  /** Load colour map without marking the score dirty. */
  seedColors(voiceColors = {}) {
    const pending = this._ensurePending();
    for (const [id, hex] of Object.entries(voiceColors || {})) {
      if (id && hex) pending.colors.set(id, hex);
    }
    this._setDirty(false);
  }

  /** Update a part colour override and mark dirty. */
  setPartColor(partId, hex) {
    if (!partId || !hex) return;
    const pending = this._ensurePending();
    pending.colors.set(partId, hex);
    this._setDirty(true);
  }

  getPartColor(partId) {
    if (!partId) return null;
    return this._ensurePending().colors.get(partId) || null;
  }

  /**
   * Rename a MusicXML part (stave label). Updates pending edits + on-score text.
   * @param {string} partId
   * @param {string} name
   * @param {{ notify?: boolean }} [opts] — when false, skip onPartRename (caller already synced UI)
   */
  renamePart(partId, name, opts = {}) {
    const next = String(name || "").trim();
    if (!partId || !next || !this.xml) return;
    const pending = this._ensurePending();
    pending.parts.set(partId, next);
    for (const el of this.container.querySelectorAll(
      `text[data-pp-edit="part"][data-pp-part-id="${String(partId).replace(/"/g, "")}"]`,
    )) {
      el.textContent = next;
    }
    this._setDirty(true);
    if (opts.notify !== false && typeof this.onPartRename === "function") {
      this.onPartRename(partId, next);
    }
  }

  /**
   * Apply pending edits into MusicXML text and return it (does not clear dirty).
   */
  buildEditedXml() {
    if (!this.xml) return "";
    let xml = applyMusicXmlEdits(this.xml, this.getEdits());
    xml = writeAnnotationLayers(xml, this.layers);
    return xml;
  }

  markSaved(xmlText) {
    this.xml = xmlText;
    this._pending = null;
    this._setDirty(false);
  }

  /** Mark the score as having unsaved edits (e.g. after annotation insert). */
  markDirty() {
    this._setDirty(true);
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

  _applyStaffLineRules() {
    if (!this.osmd?.EngravingRules) return;
    try {
      const rules = this.osmd.EngravingRules;
      if (this.showStaffLines) {
        rules.StaffLineWidth = 0.1;
        rules.LedgerLineWidth = 1;
      } else {
        rules.StaffLineWidth = 0;
        rules.LedgerLineWidth = 0;
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {boolean} show
   * @param {{rerender?: boolean}} [opts]
   */
  async setShowStaffLines(show, opts = {}) {
    this.showStaffLines = !!show;
    const pending = this._ensurePending();
    const lines = this.showStaffLines ? 5 : 0;
    if (pending.staffLines !== lines) {
      pending.staffLines = lines;
      this._setDirty(true);
    }
    if (!this.osmd || !this._ready) return;
    this._applyStaffLineRules();
    if (opts.rerender === false) return;
    await this._rerenderKeepPlayhead({ scroll: false });
  }

  async _rerenderKeepPlayhead({ scroll = true } = {}) {
    const wasHidden = this.container.hidden;
    if (wasHidden) this.container.hidden = false;
    this._applyCursorStyle();
    this._applyStaffLineRules();
    this._applyLayerEngravingRules();
    this.osmd.zoom = this.zoom;
    try {
      if (typeof this.osmd.updateGraphic === "function") this.osmd.updateGraphic();
    } catch {
      /* ignore */
    }
    this.osmd.render();
    this.applyVoiceVisibility();
    this._refreshMaxCursorHeight();
    this._finishAnnotationPresentation();
    this._buildTimeline();
    this._bindInlineEditors();
    this.setPlayhead(this._lastPlayheadTick, { scroll });
    if (wasHidden) this.container.hidden = true;
  }

  getXml() {
    return this.xml;
  }

  /**
   * @param {string} xmlText
   * @param {{
   *   voices: {id:string, channel:number, partId?:string}[],
   *   isVoiceAudible:(id:string)=>boolean,
   *   voiceGain?: (id:string)=>number,
   *   isVoiceVisible?: (id:string)=>boolean,
   *   ticksPerBeat?: number,
   *   onsetTicks?: number[],
   * }} opts
   */
  async load(xmlText, opts) {
    await this.ensure();
    this.clear();
    this.xml = xmlText;
    this._isVoiceAudible = opts.isVoiceAudible || (() => true);
    this._voiceGain =
      opts.voiceGain || ((id) => (this._isVoiceAudible(id) ? 1 : 0));
    this._isVoiceVisible = opts.isVoiceVisible || (() => true);
    this.ticksPerBeat = Math.max(1, opts.ticksPerBeat || 480);
    this._onsetTicks = Array.isArray(opts.onsetTicks)
      ? opts.onsetTicks.slice().sort((a, b) => a - b)
      : [];

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
      this._applyStaffLineRules();

      await this.osmd.load(xmlText);
      this.osmd.zoom = this.zoom;
      this.layers = readAnnotationLayers(xmlText);
      this._applyStaffLineRules();
      this._applyLayerEngravingRules();
      try {
        if (typeof this.osmd.updateGraphic === "function") this.osmd.updateGraphic();
      } catch {
        /* ignore */
      }
      this.osmd.render();
      this._mapInstruments(opts.voices || []);
      this.applyVoiceVisibility();
      this._refreshMaxCursorHeight();
      this._finishAnnotationPresentation();
      this._buildTimeline();
      this._bindInlineEditors();
      this._ready = true;
      this.setPlayhead(opts.playheadTick ?? 0, { scroll: false });
      if (typeof this.onLayersChange === "function") this.onLayersChange({ ...this.layers });
    } finally {
      restore();
    }
  }

  /**
   * Reload MusicXML while preserving zoom / playhead / staff-line preference.
   */
  async reloadXml(xmlText, opts = {}) {
    const playhead = this._lastPlayheadTick;
    const zoom = this.zoom;
    const showLines = this.showStaffLines;
    const wasDirty = this.dirty;
    await this.load(xmlText, {
      ...opts,
      playheadTick: playhead,
    });
    this.zoom = zoom;
    this.showStaffLines = showLines;
    if (this.osmd) {
      this.osmd.zoom = zoom;
      await this._rerenderKeepPlayhead({ scroll: true });
    }
    this._setDirty(wasDirty);
  }

  async revealAndRender() {
    if (!this.osmd || !this.xml) return;
    this.container.hidden = false;
    const width = await this._waitForWidth();
    this._configurePageWidth(width);
    await this._rerenderKeepPlayhead({ scroll: true });
  }

  /**
   * @param {number} zoom
   * @param {{scroll?: boolean}} [opts]
   */
  async setZoom(zoom, opts = {}) {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || ZOOM_DEFAULT));
    if (!this.osmd || !this._ready) return this.zoom;
    await this._rerenderKeepPlayhead({ scroll: opts.scroll !== false });
    return this.zoom;
  }

  zoomBy(delta) {
    return this.setZoom(this.zoom + delta);
  }

  /** Whole-note time → project ticks (quarter = ticksPerBeat). */
  _wnToTick(wn) {
    return Math.round(wn * 4 * this.ticksPerBeat);
  }

  _tickToWn(tick) {
    return tick / (4 * this.ticksPerBeat);
  }

  /**
   * True when the iterator sits on at least one pitched (non-rest) note.
   * Matches OSMD's moveToNextVisibleVoiceEntry(notesOnly=true) check.
   */
  _iteratorHasPitchedNote(iterator) {
    const entries =
      iterator?.CurrentVoiceEntries ||
      iterator?.currentVoiceEntries ||
      [];
    for (const ve of entries) {
      const notes = ve?.Notes || ve?.notes || [];
      for (const note of notes) {
        if (!note) continue;
        const isRest =
          typeof note.isRest === "function" ? note.isRest() : !!note.isRest;
        if (isRest) continue;
        if (note.Pitch || note.pitch || note.halfTone != null || note.HalfTone != null) {
          return true;
        }
      }
    }
    return false;
  }

  /** Reset OSMD cursor, then land on the first pitched-note entry. */
  _resetCursorToFirstNote() {
    const cursor = this.osmd?.cursor;
    if (!cursor) return;
    cursor.reset();
    this._cursorIdx = 0;
    // reset() may land on a rest / empty slice — skip to first pitched note.
    if (!iteratorEnded(cursor.iterator) && !this._iteratorHasPitchedNote(cursor.iterator)) {
      this._advanceCursorNotesOnly();
      this._cursorIdx = 0;
    }
    try {
      cursor.update();
    } catch {
      /* ignore */
    }
  }

  /**
   * Advance one step among pitched notes only (skip rest-only slices).
   * Public cursor.next() uses notesOnly=false and splits bars on rests.
   */
  _advanceCursorNotesOnly() {
    const cursor = this.osmd?.cursor;
    const it = cursor?.iterator;
    if (!cursor || !it || iteratorEnded(it)) return false;
    if (typeof it.moveToNextVisibleVoiceEntry === "function") {
      it.moveToNextVisibleVoiceEntry(true);
    } else {
      // Fallback: walk next() until a pitched note appears.
      do {
        cursor.next();
      } while (!iteratorEnded(cursor.iterator) && !this._iteratorHasPitchedNote(cursor.iterator));
    }
    try {
      cursor.update();
    } catch {
      /* ignore */
    }
    return !iteratorEnded(cursor.iterator);
  }

  _buildTimeline() {
    this._timeline = [];
    this._cursorIdx = 0;
    const cursor = this.osmd?.cursor;
    if (!cursor) return;
    try {
      cursor.show();
      this._resetCursorToFirstNote();
      let guard = 0;
      while (!iteratorEnded(cursor.iterator) && guard++ < 200000) {
        if (this._iteratorHasPitchedNote(cursor.iterator)) {
          try {
            cursor.update();
          } catch {
            /* ignore */
          }
          const wn = fractionReal(
            cursor.iterator.currentTimeStamp ?? cursor.iterator.CurrentTimestamp,
          );
          this._timeline.push({
            wn,
            tick: this._wnToTick(wn),
            x: this._leftmostNoteheadX(),
          });
        }
        if (!this._advanceCursorNotesOnly()) break;
      }
      this._resetCursorToFirstNote();
      this._ensureCursorVisible();
    } catch {
      this._timeline = [];
    }
  }

  /**
   * Leftmost pitched notehead AbsolutePosition.x under the current OSMD cursor.
   * Falls back to staff-entry x when notehead graphics are missing.
   */
  _leftmostNoteheadX() {
    const cursor = this.osmd?.cursor;
    if (!cursor) return null;
    let minX = null;
    try {
      const gnotes =
        typeof cursor.GNotesUnderCursor === "function" ? cursor.GNotesUnderCursor() : [];
      for (const gn of gnotes) {
        const src = gn?.sourceNote || gn?.getSourceNote?.();
        const isRest =
          src && typeof src.isRest === "function" ? src.isRest() : !!src?.isRest;
        if (isRest) continue;
        const x = gn?.PositionAndShape?.AbsolutePosition?.x;
        if (typeof x === "number" && Number.isFinite(x)) {
          minX = minX == null ? x : Math.min(minX, x);
        }
      }
    } catch {
      /* ignore */
    }
    return minX;
  }

  /**
   * Snap transport tick to the onset that is currently sounding (last onset ≤ tick).
   */
  _activeOnsetTick(tick) {
    const t = tick | 0;
    if (!this._onsetTicks.length) return t;
    let lo = 0;
    let hi = this._onsetTicks.length - 1;
    let best = this._onsetTicks[0];
    if (t < best) return best;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this._onsetTicks[mid];
      if (v <= t) {
        best = v;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  _onsetIndex(tick) {
    const onset = this._activeOnsetTick(tick);
    let idx = 0;
    for (let i = 0; i < this._onsetTicks.length; i++) {
      if (this._onsetTicks[i] <= onset) idx = i;
      else break;
    }
    return idx;
  }

  /**
   * Map playhead → OSMD note-slice index by whole-note time only.
   * (Index mapping to project onsets can desync when slice counts differ per bar.)
   */
  _timelineIndexForTick(tick) {
    if (!this._timeline.length) return 0;
    const onsetTick = this._activeOnsetTick(tick);
    const targetWn = this._tickToWn(onsetTick);
    let idx = 0;
    for (let i = 0; i < this._timeline.length; i++) {
      if (this._timeline[i].wn <= targetWn + 1e-9) idx = i;
      else break;
    }
    return idx;
  }

  /**
   * Move OSMD cursor to the pitched note entry for the active onset at ``tick``.
   * @param {number} tick
   * @param {{scroll?: boolean}} [opts]
   */
  setPlayhead(tick, opts = {}) {
    if (!this._ready || !this.osmd?.cursor) return;
    const wantScroll = opts.scroll !== false;
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

    const idx = this._timelineIndexForTick(this._lastPlayheadTick);
    const targetWn = this._timeline[idx]?.wn;

    // Resync from the start when jumping backwards or when the iterator drifted.
    const curWn = fractionReal(
      cursor.iterator?.currentTimeStamp ?? cursor.iterator?.CurrentTimestamp,
    );
    const drifted =
      targetWn != null && this._cursorIdx === idx && Math.abs(curWn - targetWn) > 1e-4;
    if (idx < this._cursorIdx || drifted) {
      this._resetCursorToFirstNote();
    }
    while (this._cursorIdx < idx && !iteratorEnded(cursor.iterator)) {
      if (!this._advanceCursorNotesOnly()) break;
      this._cursorIdx += 1;
    }
    try {
      // Let OSMD place the cursor in the correct system first.
      cursor.update();
    } catch {
      /* ignore */
    }
    // Align the bar to the painted noteheads under the cursor (DOM), not OSMD units.
    this._nudgeCursorToNoteheads();
    this._ensureCursorVisible();
    if (wantScroll) this._maybeAutoScroll();
  }

  /** Call when playback starts so the sheet follows the cursor again. */
  enableFollowScroll() {
    this._followScroll = true;
  }

  /**
   * Vertical relationship of the playhead to the scrollport.
   * @returns {"above"|"below"|"in"|null}
   */
  _cursorVerticalRelation() {
    const el = this.osmd?.cursor?.cursorElement;
    if (!el || this.container.hidden) return null;
    const er = el.getBoundingClientRect();
    const pr = this.container.getBoundingClientRect();
    if (!er.width && !er.height && er.top === 0 && er.bottom === 0) return null;
    const mid = (er.top + er.bottom) / 2;
    if (mid < pr.top) return "above";
    if (mid > pr.bottom) return "below";
    return "in";
  }

  _maybeAutoScroll() {
    if (this._followScroll) {
      this._scrollCursorIntoView({ mode: "follow" });
      return;
    }
    // User scrolled ahead (or away): resume only when the playhead's vertical
    // mid-point lands inside the visible scrollport again.
    if (this._cursorVerticalRelation() === "in") {
      this._followScroll = true;
      this._scrollCursorIntoView({ mode: "follow" });
    }
  }

  /**
   * Client-space bounds for alignment under the OSMD cursor.
   * Uses notehead layout boxes for X (even when staves are CSS-hidden) and
   * visible lyrics/chords/notes for the vertical span of the current system.
   * @returns {{left:number, top:number, bottom:number}|null} container-content coords
   */
  _cursorAlignBounds() {
    const cursor = this.osmd?.cursor;
    if (!cursor) return null;
    const host = this.container.getBoundingClientRect();
    const scrollL = this.container.scrollLeft;
    const scrollT = this.container.scrollTop;
    const stavesOn = !!this.layers.staves;

    let minLeft = null;
    /** @type {Set<Element>} */
    const staffGroups = new Set();

    try {
      const gnotes =
        typeof cursor.GNotesUnderCursor === "function" ? cursor.GNotesUnderCursor() : [];
      for (const gn of gnotes) {
        const src = gn?.sourceNote || gn?.getSourceNote?.();
        const isRest =
          src && typeof src.isRest === "function" ? src.isRest() : !!src?.isRest;
        if (isRest) continue;
        const instrIndex = this._instrumentIndexFromNote(gn);
        const voice = this.instrumentVoices[instrIndex];
        if (voice && typeof this._isVoiceVisible === "function" && !this._isVoiceVisible(voice.id)) {
          continue;
        }
        const svgEl = gn?.getSVGGElement?.() || gn?.svggElement;
        if (!svgEl || typeof svgEl.getBoundingClientRect !== "function") continue;
        const r = svgEl.getBoundingClientRect();
        // Noteheads keep layout when CSS-hidden; still use them for X.
        if (!(r.width > 0 || r.height > 0)) continue;
        const left = r.left - host.left + scrollL;
        minLeft = minLeft == null ? left : Math.min(minLeft, left);
        const staffG = svgEl.closest?.("g.staffline");
        if (staffG) staffGroups.add(staffG);
      }
    } catch {
      return null;
    }
    if (minLeft == null) return null;

    let minTop = null;
    let maxBottom = null;
    const absorb = (el) => {
      if (!el || typeof el.getBoundingClientRect !== "function") return;
      const st = globalThis.getComputedStyle?.(el);
      if (st && (st.visibility === "hidden" || st.display === "none" || st.opacity === "0")) {
        return;
      }
      const r = el.getBoundingClientRect();
      if (!(r.width > 0.5 || r.height > 0.5)) return;
      const top = r.top - host.top + scrollT;
      const bottom = r.bottom - host.top + scrollT;
      minTop = minTop == null ? top : Math.min(minTop, top);
      maxBottom = maxBottom == null ? bottom : Math.max(maxBottom, bottom);
    };

    const groups = staffGroups.size
      ? [...staffGroups]
      : [...(this.container.querySelectorAll("g.staffline") || [])];

    for (const g of groups) {
      if (stavesOn) {
        // Visible notation in this staffline (skip CSS-hidden stave chrome).
        for (const el of g.querySelectorAll("path, rect, use, text")) {
          // Only count notehead-ish marks: skip empty staff lines (long thin rects/lines).
          const r = el.getBoundingClientRect();
          if (r.height < 2 || r.width < 2) continue;
          absorb(el);
        }
      }
      if (this.layers.lyrics) {
        for (const el of g.querySelectorAll(".lyrics, .dash")) absorb(el);
      }
      if (this.layers.chords) {
        for (const el of g.querySelectorAll(".pp-chord")) absorb(el);
      }
      if (this.layers.notes) {
        for (const el of g.querySelectorAll(".pp-annot-note")) absorb(el);
      }
    }

    // Always include the active noteheads for X/Y (layout exists even if stave-off).
    try {
      const gnotes =
        typeof cursor.GNotesUnderCursor === "function" ? cursor.GNotesUnderCursor() : [];
      for (const gn of gnotes) {
        const src = gn?.sourceNote || gn?.getSourceNote?.();
        const isRest =
          src && typeof src.isRest === "function" ? src.isRest() : !!src?.isRest;
        if (isRest) continue;
        const svgEl = gn?.getSVGGElement?.() || gn?.svggElement;
        if (!svgEl) continue;
        if (stavesOn) absorb(svgEl);
        else {
          // Stave-off: noteheads are hidden — still use their y as a fallback mid-line.
          const r = svgEl.getBoundingClientRect();
          if (!(r.width > 0 || r.height > 0)) continue;
          if (minTop != null && maxBottom != null) continue;
          const top = r.top - host.top + scrollT;
          const bottom = r.bottom - host.top + scrollT;
          minTop = minTop == null ? top : Math.min(minTop, top);
          maxBottom = maxBottom == null ? bottom : Math.max(maxBottom, bottom);
        }
      }
    } catch {
      /* ignore */
    }

    if (minTop == null || maxBottom == null || !(maxBottom > minTop)) {
      return { left: minLeft, top: 0, bottom: 40 };
    }
    // Small pad so the bar clearly brackets the active row(s).
    const pad = 4;
    return {
      left: minLeft,
      top: Math.max(0, minTop - pad),
      bottom: maxBottom + pad,
    };
  }

  /**
   * Place/size the cursor bar to the current onset: X at noteheads, top at the
   * active system. Height is the score-wide max so the bar (and follow target)
   * does not jump between short and tall systems.
   */
  _nudgeCursorToNoteheads() {
    const el = this.osmd?.cursor?.cursorElement;
    if (!el) return;
    const bounds = this._cursorAlignBounds();
    if (!bounds) return;
    const natural = Math.max(16, bounds.bottom - bounds.top);
    if (natural > (this._maxCursorHeight || 0)) this._maxCursorHeight = natural;
    const height = Math.max(natural, this._maxCursorHeight || natural);
    el.style.left = `${Math.max(0, bounds.left - CURSOR_HEAD_GAP_PX)}px`;
    el.style.top = `${bounds.top}px`;
    el.style.height = `${height}px`;
    el.style.width = el.style.width || "2px";
    el.style.maxHeight = "none";
    el.style.objectFit = "fill";
  }

  /**
   * Measure the tallest vertical system cluster so the playhead can use a
   * constant length for the whole score (avoids follow-scroll Y jumps).
   */
  _refreshMaxCursorHeight() {
    const groups = [...(this.container.querySelectorAll("g.staffline") || [])];
    if (!groups.length) {
      this._maxCursorHeight = 0;
      return;
    }
    const host = this.container.getBoundingClientRect();
    const scrollT = this.container.scrollTop;
    const items = [];
    for (const g of groups) {
      const r = g.getBoundingClientRect();
      if (!(r.height > 1)) continue;
      items.push({
        top: r.top - host.top + scrollT,
        bottom: r.bottom - host.top + scrollT,
      });
    }
    items.sort((a, b) => a.top - b.top);
    let maxH = 0;
    let i = 0;
    while (i < items.length) {
      let top = items[i].top;
      let bottom = items[i].bottom;
      let j = i + 1;
      // Stafflines in one system sit within a modest vertical gap.
      while (j < items.length && items[j].top <= bottom + 120) {
        bottom = Math.max(bottom, items[j].bottom);
        j += 1;
      }
      maxH = Math.max(maxH, bottom - top);
      i = j;
    }
    this._maxCursorHeight = Math.max(40, Math.ceil(maxH + 8));
  }

  /**
   * Click seeks, or opens edit for an existing chord / performance note.
   */
  _onContainerClick(ev) {
    if (!this._ready) return;
    if (this._editInput || this._annotInput) return;
    const t = ev.target;
    if (t?.closest?.(".sheet-inline-edit") || t?.closest?.(".sheet-annot-input")) return;
    if (t?.closest?.("[data-pp-edit]")) return;
    if (t?.closest?.("img.osmd-cursor") || t?.classList?.contains?.("cursor")) return;

    const annotEl = t?.closest?.(".pp-chord, .pp-annot-note");
    if (annotEl) {
      ev.preventDefault();
      ev.stopPropagation();
      void this._beginAnnotationEdit(annotEl, ev);
      return;
    }

    const hit = this._nearestOnsetAtClient(ev.clientX, ev.clientY);
    if (!hit) return;
    ev.preventDefault();
    if (typeof this.onSeek === "function") this.onSeek(hit.tick);
  }

  /**
   * @param {Element} annotEl
   * @param {MouseEvent} ev
   */
  async _beginAnnotationEdit(annotEl, ev) {
    if (!this.xml) return;
    this._cancelAnnotInput();

    const kind =
      annotEl.classList.contains("pp-annot-note") || annotEl.closest(".pp-annot-note")
        ? "note"
        : "chord";
    const textHost = annotEl.closest("text") || (annotEl.tagName?.toLowerCase() === "text" ? annotEl : annotEl);
    const originalText = String(textHost?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!originalText) return;

    const hit = this._nearestOnsetAtClient(ev.clientX, ev.clientY);
    const tick = hit?.tick ?? (this._lastPlayheadTick | 0);
    this.setAnnotMode(kind);
    if (typeof this.onSeek === "function") this.onSeek(tick);
    this.setPlayhead(tick, { scroll: true });
    await nextFrame();
    await nextFrame();
    this._openAnnotInput(kind, tick, { mode: "edit", originalText });
  }

  /**
   * @param {null|"chord"|"note"} mode
   */
  setAnnotMode(mode) {
    const next = mode === "chord" || mode === "note" ? mode : null;
    this.annotMode = next;
    this.container.classList.toggle("pp-annot-chord", next === "chord");
    this.container.classList.toggle("pp-annot-note", next === "note");
    if (typeof this.onAnnotModeChange === "function") this.onAnnotModeChange(next);
  }

  /**
   * Open an inline text field at the current playhead / OSMD cursor and insert
   * a chord or performance note at that onset when confirmed.
   * @param {"chord"|"note"} kind
   */
  async beginAnnotationAtCursor(kind) {
    if (!this._ready || !this.xml) return;
    if (kind !== "chord" && kind !== "note") return;
    this._cancelAnnotInput();
    this.setAnnotMode(kind);

    const tick = this._onsetTicks.length
      ? this._activeOnsetTick(this._lastPlayheadTick)
      : this._lastPlayheadTick | 0;
    this.setPlayhead(tick, { scroll: true });
    await nextFrame();
    await nextFrame();
    this._openAnnotInput(kind, tick);
  }

  _cancelAnnotInput() {
    if (this._annotInput) {
      this._annotInput.remove();
      this._annotInput = null;
    }
    this._annotCtx = null;
    this.setAnnotMode(null);
  }

  /**
   * @param {"chord"|"note"} kind
   * @param {number} tick
   * @param {{mode?: "add"|"edit", originalText?: string}} [opts]
   */
  _openAnnotInput(kind, tick, opts = {}) {
    this._cancelInlineEdit();
    if (this._annotInput) this._annotInput.remove();

    const mode = opts.mode === "edit" ? "edit" : "add";
    const originalText = String(opts.originalText || "").trim();

    const cs = getComputedStyle(this.container);
    if (cs.position === "static") this.container.style.position = "relative";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "sheet-annot-input";
    if (mode === "edit") {
      input.placeholder =
        kind === "chord" ? "Edit chord (empty deletes)" : "Edit note (empty deletes)";
      input.setAttribute(
        "aria-label",
        kind === "chord" ? "Edit chord symbol" : "Edit performance note",
      );
      input.value = originalText;
    } else {
      input.placeholder =
        kind === "chord" ? "Chord (e.g. Am, G7)" : "Performance note";
      input.setAttribute(
        "aria-label",
        kind === "chord" ? "Chord symbol at cursor" : "Performance note at cursor",
      );
      input.value = "";
    }

    const host = this.container.getBoundingClientRect();
    const cursorEl = this.osmd?.cursor?.cursorElement;
    let left = 48;
    let top = 24;
    if (cursorEl) {
      const r = cursorEl.getBoundingClientRect();
      left = r.left - host.left + this.container.scrollLeft + 8;
      top = Math.max(4, r.top - host.top + this.container.scrollTop - 4);
    }
    input.style.left = `${Math.max(0, left)}px`;
    input.style.top = `${Math.max(0, top)}px`;

    this._annotInput = input;
    this._annotCtx = { kind, tick, mode, originalText };
    this.container.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      const text = input.value.trim();
      const ctx = this._annotCtx;
      this._annotInput = null;
      this._annotCtx = null;
      input.remove();
      this.setAnnotMode(null);
      if (!commit || !ctx) return;
      if (ctx.mode === "edit") {
        void this._commitAnnotationEdit(ctx, text);
        return;
      }
      if (!text) return;
      void this._commitAnnotationAtTick(ctx.kind, ctx.tick, text);
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      } else if (
        (ev.key === "Delete" || ev.key === "Backspace") &&
        mode === "edit" &&
        !input.value
      ) {
        // Already empty: Delete/Backspace confirms removal.
        ev.preventDefault();
        finish(true);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  getLayers() {
    return { ...this.layers };
  }

  /**
   * Toggle which score layers are drawn. Persisted into MusicXML on save.
   * @param {Partial<{staves:boolean, lyrics:boolean, chords:boolean, notes:boolean}>} partial
   */
  async setLayers(partial = {}) {
    this.layers = { ...this.layers, ...partial };
    if (this.xml) {
      try {
        // Keep base xml layers in sync without wiping pending title/part edits.
        this.xml = writeAnnotationLayers(this.xml, this.layers);
      } catch {
        /* ignore */
      }
      this._setDirty(true);
    }
    if (typeof this.onLayersChange === "function") this.onLayersChange({ ...this.layers });
    if (this.osmd && this._ready) {
      await this._rerenderKeepPlayhead({ scroll: false });
    }
  }

  _applyLayerEngravingRules() {
    if (!this.osmd?.EngravingRules) return;
    try {
      const rules = this.osmd.EngravingRules;
      if (!this._engravingDefaults) {
        this._engravingDefaults = {
          StaffHeight: rules.StaffHeight,
          BetweenStaffDistance: rules.BetweenStaffDistance,
          StaffDistance: rules.StaffDistance,
          MinimumDistanceBetweenSystems: rules.MinimumDistanceBetweenSystems,
          MinSkyBottomDistBetweenStaves: rules.MinSkyBottomDistBetweenStaves,
          MinSkyBottomDistBetweenSystems: rules.MinSkyBottomDistBetweenSystems,
          BetweenStaffLinesDistance: rules.BetweenStaffLinesDistance,
          StemWidth: rules.StemWidth,
          StaffLineWidth: rules.StaffLineWidth,
          LedgerLineWidth: rules.LedgerLineWidth,
          LyricsHeight: rules.LyricsHeight,
          LyricsYOffsetToStaffHeight: rules.LyricsYOffsetToStaffHeight,
          LyricsYMarginToBottomLine: rules.LyricsYMarginToBottomLine,
          PageLeftMargin: rules.PageLeftMargin,
          SystemLeftMargin: rules.SystemLeftMargin,
          MeasureLeftMargin: rules.MeasureLeftMargin,
          ClefLeftMargin: rules.ClefLeftMargin,
          RenderClefsAtBeginningOfStaffline: rules.RenderClefsAtBeginningOfStaffline,
          RenderKeySignatures: rules.RenderKeySignatures,
          RenderTimeSignatures: rules.RenderTimeSignatures,
          RenderSingleHorizontalStaffline: rules.RenderSingleHorizontalStaffline,
        };
      }
      const d = this._engravingDefaults;
      rules.RenderLyrics = !!this.layers.lyrics;
      rules.RenderChordSymbols = !!this.layers.chords;
      // Always keep staff + lyric metrics at their normal size. Shrinking
      // StaffHeight also shrinks lyric glyphs (OSMD scales text with the staff),
      // which produced the microscopic "smudge" when staves were toggled off.
      rules.StaffHeight = d.StaffHeight;
      if (d.LyricsHeight != null) rules.LyricsHeight = d.LyricsHeight;
      rules.LyricsYOffsetToStaffHeight = d.LyricsYOffsetToStaffHeight;
      rules.LyricsYMarginToBottomLine = d.LyricsYMarginToBottomLine;
      rules.BetweenStaffLinesDistance = d.BetweenStaffLinesDistance;
      if (!this.layers.staves) {
        // Hide notation via CSS; only suppress engraving chrome OSMD can omit.
        // Vertical packing (_packHiddenStavesVertical) collapses the empty staff gaps.
        rules.StaffLineWidth = 0;
        rules.LedgerLineWidth = 0;
        rules.StemWidth = 0;
        rules.BetweenStaffDistance = Math.min(d.BetweenStaffDistance ?? 5, 2.5);
        rules.StaffDistance = Math.min(d.StaffDistance ?? 5, 2.5);
        rules.MinimumDistanceBetweenSystems = Math.min(
          d.MinimumDistanceBetweenSystems ?? 5,
          2.5,
        );
        rules.MinSkyBottomDistBetweenStaves = Math.min(
          d.MinSkyBottomDistBetweenStaves ?? 1,
          0.5,
        );
        rules.MinSkyBottomDistBetweenSystems = Math.min(
          d.MinSkyBottomDistBetweenSystems ?? 1,
          0.5,
        );
        // Drop clef/key/time indent so lyric-only view isn't heavily left-padded.
        rules.PageLeftMargin = Math.min(d.PageLeftMargin ?? 5, 1.5);
        rules.SystemLeftMargin = 0;
        rules.MeasureLeftMargin = Math.min(d.MeasureLeftMargin ?? 0.7, 0.25);
        if (d.ClefLeftMargin != null) rules.ClefLeftMargin = 0;
        rules.RenderSingleHorizontalStaffline = false;
        rules.RenderClefsAtBeginningOfStaffline = false;
        rules.RenderKeySignatures = false;
        rules.RenderTimeSignatures = false;
      } else {
        rules.BetweenStaffDistance = d.BetweenStaffDistance;
        rules.StaffDistance = d.StaffDistance;
        rules.MinimumDistanceBetweenSystems = d.MinimumDistanceBetweenSystems;
        rules.MinSkyBottomDistBetweenStaves = d.MinSkyBottomDistBetweenStaves;
        rules.MinSkyBottomDistBetweenSystems = d.MinSkyBottomDistBetweenSystems;
        rules.StemWidth = d.StemWidth ?? 0.15;
        rules.PageLeftMargin = d.PageLeftMargin;
        rules.SystemLeftMargin = d.SystemLeftMargin;
        rules.MeasureLeftMargin = d.MeasureLeftMargin;
        if (d.ClefLeftMargin != null) rules.ClefLeftMargin = d.ClefLeftMargin;
        rules.RenderSingleHorizontalStaffline = !!d.RenderSingleHorizontalStaffline;
        rules.RenderClefsAtBeginningOfStaffline =
          d.RenderClefsAtBeginningOfStaffline !== false;
        rules.RenderKeySignatures = d.RenderKeySignatures !== false;
        rules.RenderTimeSignatures = d.RenderTimeSignatures !== false;
        if (this.showStaffLines) {
          rules.StaffLineWidth = d.StaffLineWidth ?? 0.1;
          rules.LedgerLineWidth = d.LedgerLineWidth ?? 1;
        } else {
          rules.StaffLineWidth = 0;
          rules.LedgerLineWidth = 0;
        }
      }
    } catch {
      /* ignore */
    }
  }

  _finishAnnotationPresentation() {
    this._tagAnnotationSvg();
    this.container.classList.toggle("pp-hide-staves", !this.layers.staves);
    this.container.classList.toggle("pp-hide-lyrics", !this.layers.lyrics);
    this.container.classList.toggle("pp-hide-chords", !this.layers.chords);
    this.container.classList.toggle("pp-hide-notes", !this.layers.notes);
    this._packHiddenStavesVertical();
    // Packing / layer CSS changes layout — re-align the playhead bar.
    if (this._ready && this.osmd?.cursor) {
      try {
        this._nudgeCursorToNoteheads();
        this._ensureCursorVisible();
      } catch {
        /* ignore */
      }
    }
  }

  /** Restore SVG viewBox / size after stave-off packing (or before a fresh pack). */
  _restoreSvgLayout(svg) {
    if (!svg) return;
    const staffGs = [...svg.querySelectorAll("g.staffline")];
    for (const g of staffGs) {
      g.style.transform = "";
      g.style.display = "";
    }
    const bak = this._svgLayoutBackup;
    if (bak && bak.svg === svg) {
      if (bak.viewBox != null) svg.setAttribute("viewBox", bak.viewBox);
      else svg.removeAttribute("viewBox");
      if (bak.width != null) svg.setAttribute("width", bak.width);
      else svg.removeAttribute("width");
      if (bak.height != null) svg.setAttribute("height", bak.height);
      else svg.removeAttribute("height");
      svg.style.height = bak.styleHeight || "";
      svg.style.width = bak.styleWidth || "";
      svg.style.overflow = bak.styleOverflow || "";
    } else {
      svg.style.height = "";
      svg.style.overflow = "";
    }
  }

  /**
   * When stave notation is hidden, pack lyric/chord/note rows and crop the
   * SVG viewBox to that band — keeping the original horizontal scale so text
   * stays legible. Never squash the full-score viewBox into a short CSS height
   * (that uniformly shrinks lyrics to a speck).
   */
  _packHiddenStavesVertical() {
    const svg = this.container.querySelector("svg");
    if (!svg) return;

    this._restoreSvgLayout(svg);

    if (this.layers.staves) {
      this._svgLayoutBackup = null;
      return;
    }

    const staffGs = [...svg.querySelectorAll("g.staffline")];
    if (!staffGs.length) return;

    if (!this._svgLayoutBackup || this._svgLayoutBackup.svg !== svg) {
      this._svgLayoutBackup = {
        svg,
        viewBox: svg.getAttribute("viewBox"),
        width: svg.getAttribute("width"),
        height: svg.getAttribute("height"),
        styleHeight: svg.style.height || "",
        styleWidth: svg.style.width || "",
        styleOverflow: svg.style.overflow || "",
      };
    }

    const GAP_PX = 10;
    const TOP_MARGIN_PX = 12;
    const BOTTOM_MARGIN_PX = 14;

    /** @type {{ g: SVGGElement, top: number, bottom: number }[]} */
    const rows = [];
    for (const g of staffGs) {
      const keep = g.querySelectorAll(".lyrics, .dash, .pp-chord, .pp-annot-note");
      let top = Infinity;
      let bottom = -Infinity;
      for (const el of keep) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0.5 || r.height > 0.5)) continue;
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
      }
      if (!(bottom > top) || !Number.isFinite(top)) {
        g.style.display = "none";
        continue;
      }
      rows.push({ g, top, bottom });
    }

    if (!rows.length) return;

    rows.sort((a, b) => a.top - b.top || a.bottom - b.bottom);

    const svgRect = svg.getBoundingClientRect();
    const ctm = svg.getScreenCTM?.();
    const pxToUserY = ctm && Math.abs(ctm.d) > 1e-6 ? 1 / ctm.d : 1;
    const pxToUserX = ctm && Math.abs(ctm.a) > 1e-6 ? 1 / ctm.a : 1;

    let cursorPx = svgRect.top + TOP_MARGIN_PX;
    for (const row of rows) {
      const deltaPx = cursorPx - row.top;
      row.g.style.transform = `translateY(${deltaPx * pxToUserY}px)`;
      cursorPx += row.bottom - row.top + GAP_PX;
    }

    // Measure packed content in screen space, then map into SVG user units.
    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;
    for (const row of rows) {
      for (const el of row.g.querySelectorAll(".lyrics, .dash, .pp-chord, .pp-annot-note")) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0.5 || r.height > 0.5)) continue;
        minLeft = Math.min(minLeft, r.left);
        minTop = Math.min(minTop, r.top);
        maxRight = Math.max(maxRight, r.right);
        maxBottom = Math.max(maxBottom, r.bottom);
      }
    }
    if (!(maxBottom > minTop) || !(maxRight > minLeft)) return;

    const padX = 8;
    const padTop = TOP_MARGIN_PX;
    const padBottom = BOTTOM_MARGIN_PX;
    const userX = (minLeft - svgRect.left - padX) * pxToUserX;
    const userY = (minTop - svgRect.top - padTop) * pxToUserY;
    const userW = (maxRight - minLeft + padX * 2) * pxToUserX;
    const userH = (maxBottom - minTop + padTop + padBottom) * pxToUserY;

    const vb = svg.viewBox?.baseVal;
    const fullW = vb && vb.width > 0 ? vb.width : userW;
    const fullX = vb ? vb.x : 0;
    // Trim the empty first-system indent (clef/key reserve) when staves are off.
    const cropX = Math.max(fullX, Math.min(userX, fullX + fullW * 0.35));
    const cropW = Math.max(40, fullX + fullW - cropX);
    const cropY = Math.max(vb?.y ?? 0, userY);
    const cropH = Math.max(24, userH);

    svg.setAttribute("viewBox", `${cropX} ${cropY} ${cropW} ${cropH}`);

    // Keep horizontal scale: height follows cropped aspect vs displayed width.
    const displayW = svgRect.width || svg.clientWidth || cropW;
    const displayH = (cropH / cropW) * displayW;
    svg.removeAttribute("height");
    svg.style.height = `${Math.max(48, displayH)}px`;
    svg.style.overflow = "hidden";
  }

  /**
   * Mark chord labels and practice-note words in the SVG for CSS show/hide.
   */
  _tagAnnotationSvg() {
    const svg = this.container.querySelector("svg");
    if (!svg) return;

    // Lyrics already have class "lyrics" from OSMD.
    // Tag chord symbols from OSMD graphical objects when available.
    try {
      const graphic = this.osmd?.graphic;
      const measureList = graphic?.measureList || [];
      for (const staffMeasures of measureList) {
        for (const gMeasure of staffMeasures || []) {
          const entries = gMeasure?.staffEntries || [];
          for (const entry of entries) {
            const containers =
              entry.graphicalChordContainers || entry.GraphicalChordContainers || [];
            for (const c of containers) {
              const label = c?.GraphicalLabel || c?.graphicalLabel;
              const node = label?.SVGNode || label?.svgNode;
              if (node) node.classList?.add("pp-chord");
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Practice notes + chords use distinctive colours written into MusicXML.
    const noteColor = PRACTICE_NOTE_COLOR.toLowerCase();
    const chordColor = "#334155";
    for (const el of svg.querySelectorAll("text, tspan")) {
      const fill = (el.getAttribute("fill") || el.style?.fill || "").toLowerCase();
      if (!fill || fill === "none" || fill === "#000000" || fill === "black") continue;
      if (fill === noteColor || fill.includes("1a6b5c")) {
        el.classList.add("pp-annot-note");
        el.closest("g")?.classList.add("pp-annot-note");
      } else if (fill === chordColor || fill.includes("334155")) {
        el.classList.add("pp-chord");
        el.closest("g")?.classList.add("pp-chord");
      }
    }

    for (const el of svg.querySelectorAll(".pp-chord, .pp-annot-note")) {
      if (el instanceof SVGElement || el instanceof HTMLElement) {
        el.style.cursor = "pointer";
        if (!el.getAttribute("title")) {
          el.setAttribute(
            "title",
            el.classList.contains("pp-annot-note") || el.closest?.(".pp-annot-note")
              ? "Click to edit or delete note"
              : "Click to edit or delete chord",
          );
        }
      }
    }
  }

  /**
   * @param {"chord"|"note"} kind
   * @param {number} tick
   * @param {string} text
   */
  async _commitAnnotationAtTick(kind, tick, text) {
    const value = String(text || "").trim();
    if (!value) return;

    // Make sure the new annotation's layer is visible after reload.
    const layerPatch =
      kind === "chord" ? { chords: true } : { notes: true };
    if (
      (kind === "chord" && !this.layers.chords) ||
      (kind === "note" && !this.layers.notes)
    ) {
      this.layers = { ...this.layers, ...layerPatch };
      if (typeof this.onLayersChange === "function") {
        this.onLayersChange({ ...this.layers });
      }
    }

    let baseXml = this.dirty ? this.buildEditedXml() : this.xml;
    if (!baseXml) return;
    if (!this.dirty) baseXml = writeAnnotationLayers(baseXml, this.layers);

    const onset = this._onsetTicks.length ? this._activeOnsetTick(tick) : tick | 0;
    let nextXml;
    try {
      nextXml =
        kind === "chord"
          ? insertHarmonyAtTick(baseXml, onset, value)
          : insertDirectionWordsAtTick(baseXml, onset, value);
      nextXml = writeAnnotationLayers(nextXml, this.layers);
    } catch (err) {
      console.warn(err);
      return;
    }

    this._setDirty(true);
    if (typeof this.onSeek === "function") this.onSeek(onset);
    if (typeof this.onXmlMutated === "function") {
      await this.onXmlMutated(nextXml, kind === "chord" ? `Chord ${value}` : `Note: ${value}`);
    }
  }

  /**
   * @param {{kind:"chord"|"note", tick:number, originalText:string}} ctx
   * @param {string} text
   */
  async _commitAnnotationEdit(ctx, text) {
    const value = String(text || "").trim();
    const original = String(ctx.originalText || "").trim();
    if (!original) return;
    if (value === original) return;

    let baseXml = this.dirty ? this.buildEditedXml() : this.xml;
    if (!baseXml) return;
    if (!this.dirty) baseXml = writeAnnotationLayers(baseXml, this.layers);

    const onset = this._onsetTicks.length ? this._activeOnsetTick(ctx.tick) : ctx.tick | 0;
    let nextXml;
    let label;
    try {
      if (!value) {
        nextXml = removeAnnotationAtTick(baseXml, onset, ctx.kind, original);
        label =
          ctx.kind === "chord" ? `Delete chord ${original}` : `Delete note: ${original}`;
      } else {
        nextXml = updateAnnotationAtTick(baseXml, onset, ctx.kind, original, value);
        label =
          ctx.kind === "chord"
            ? `Chord ${original} → ${value}`
            : `Note: ${original} → ${value}`;
      }
      nextXml = writeAnnotationLayers(nextXml, this.layers);
    } catch (err) {
      console.warn(err);
      return;
    }

    this._setDirty(true);
    if (typeof this.onSeek === "function") this.onSeek(onset);
    if (typeof this.onXmlMutated === "function") {
      await this.onXmlMutated(nextXml, label);
    }
  }

  /**
   * Find the pitched note nearest to a client point and map it to a transport tick.
   * @returns {{tick:number, wn:number}|null}
   */
  _nearestOnsetAtClient(clientX, clientY) {
    if (!this.osmd?.graphic) return null;
    const graphic = this.osmd.graphic;
    const measureList = graphic.measureList || [];
    let bestWn = null;
    let bestScore = Infinity;

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
            const src = gNote?.sourceNote || gNote?.getSourceNote?.();
            if (!src) continue;
            const isRest =
              typeof src.isRest === "function" ? src.isRest() : !!src.isRest;
            if (isRest) continue;

            const instrIndex = this._instrumentIndexFromNote(gNote) ?? staffIndex;
            const voice =
              this.instrumentVoices[instrIndex] || this._voiceForStaffIndex(staffIndex);
            if (
              typeof this._isVoiceVisible === "function" &&
              !this._isVoiceVisible(voice.id)
            ) {
              continue;
            }

            const svg = gNote.getSVGGElement?.() || gNote.svggElement;
            if (!svg || typeof svg.getBoundingClientRect !== "function") continue;
            const r = svg.getBoundingClientRect();
            if (!(r.width > 0 || r.height > 0)) continue;

            const nx = r.left + Math.min(r.width * 0.25, 8);
            const ny = (r.top + r.bottom) / 2;
            const score = Math.hypot(clientX - nx, (clientY - ny) * 1.6);
            if (score >= bestScore || score > SEEK_HIT_MAX_PX) continue;

            const wn = this._timestampOfGraphicalNote(gNote, entry, gMeasure);
            if (wn == null) continue;
            bestScore = score;
            bestWn = wn;
          }
        }
      }
    }

    if (bestWn == null) return null;

    let tick = this._wnToTick(bestWn);
    if (this._timeline.length) {
      let closest = this._timeline[0];
      let closestD = Math.abs(closest.wn - bestWn);
      for (const slice of this._timeline) {
        const d = Math.abs(slice.wn - bestWn);
        if (d < closestD) {
          closest = slice;
          closestD = d;
        }
      }
      tick = closest.tick;
    } else if (this._onsetTicks.length) {
      tick = this._activeOnsetTick(tick);
    }
    return { tick, wn: bestWn };
  }

  /**
   * Whole-note timestamp for a graphical note (absolute in the piece).
   * @returns {number|null}
   */
  _timestampOfGraphicalNote(gNote, entry, gMeasure) {
    try {
      if (typeof entry?.getAbsoluteTimestamp === "function") {
        return fractionReal(entry.getAbsoluteTimestamp());
      }
    } catch {
      /* ignore */
    }
    try {
      const src = gNote?.sourceNote || gNote?.getSourceNote?.();
      const ts =
        src?.getAbsoluteTimestamp?.() ||
        src?.AbsoluteTimestamp ||
        src?.absoluteTimestamp ||
        src?.ParentVoiceEntry?.Timestamp ||
        src?.parentVoiceEntry?.Timestamp;
      if (ts != null) {
        // Voice-entry Timestamp is often relative to the measure.
        const measureAbs =
          gMeasure?.parentSourceMeasure?.AbsoluteTimestamp ||
          gMeasure?.parentSourceMeasure?.absoluteTimestamp ||
          src?.SourceMeasure?.AbsoluteTimestamp ||
          src?.sourceMeasure?.AbsoluteTimestamp;
        if (measureAbs != null && !src?.AbsoluteTimestamp && !src?.getAbsoluteTimestamp) {
          return fractionReal(measureAbs) + fractionReal(ts);
        }
        return fractionReal(ts);
      }
      if (entry?.relInMeasureTimestamp != null) {
        const measureAbs =
          gMeasure?.parentSourceMeasure?.AbsoluteTimestamp ||
          gMeasure?.parentSourceMeasure?.absoluteTimestamp;
        if (measureAbs != null) {
          return fractionReal(measureAbs) + fractionReal(entry.relInMeasureTimestamp);
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * Keep the active system’s top on a fixed horizontal “rail” in the viewport
   * while following, so changing systems / cursor lengths does not jump the view.
   * @param {{mode?: "follow"|"snap"}} [opts]
   */
  _scrollCursorIntoView(opts = {}) {
    const el = this.osmd?.cursor?.cursorElement;
    if (!el || this.container.hidden) return;
    const parent = this.container;
    const er = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (!er.width && !er.height && er.top === 0 && er.bottom === 0) return;

    const marginX = Math.max(40, pr.width * 0.22);
    let dx = 0;
    if (er.left < pr.left + marginX) dx = er.left - pr.left - marginX;
    else if (er.right > pr.right - marginX) dx = er.right - pr.right + marginX;

    // Pin the cursor TOP (system start), not the mid of a variable-height bar.
    const FOLLOW_TOP_FRAC = 0.14;
    const targetTop = pr.top + pr.height * FOLLOW_TOP_FRAC;
    let dy = er.top - targetTop;
    // Ignore sub-pixel / layout noise only.
    if (Math.abs(dy) < 2.5) dy = 0;

    if (!dx && !dy) return;
    this._ignoreScrollUntil = performance.now() + 160;
    parent.scrollLeft += dx;
    parent.scrollTop += dy;
    this._lastScrollLeft = parent.scrollLeft;
    this._lastScrollTop = parent.scrollTop;
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
    if (!this.osmd?.Sheet) return;
    const instruments = this.osmd.Sheet.Instruments || [];
    let layoutChanged = false;
    for (let i = 0; i < instruments.length; i++) {
      const instr = instruments[i];
      if (!instr) continue;
      const voice = this.instrumentVoices[i];
      const want =
        !voice ||
        typeof this._isVoiceVisible !== "function" ||
        this._isVoiceVisible(voice.id);
      if (instr.Visible !== want) {
        instr.Visible = want;
        layoutChanged = true;
      }
      const staves = instr.Staves || instr.staves || [];
      for (const staff of staves) {
        if (staff && staff.Visible !== want) {
          staff.Visible = want;
          layoutChanged = true;
        }
      }
    }

    if (layoutChanged && this.osmd.graphic) {
      try {
        this._applyLayerEngravingRules();
        if (typeof this.osmd.updateGraphic === "function") this.osmd.updateGraphic();
        this.osmd.render();
      } catch {
        /* ignore */
      }
      this._refreshMaxCursorHeight();
      this._finishAnnotationPresentation();
      this._buildTimeline();
      this._bindInlineEditors();
      if (this._ready) {
        this.setPlayhead(this._lastPlayheadTick, { scroll: false });
      }
    } else {
      this._finishAnnotationPresentation();
    }

    if (!this.osmd.graphic) return;
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
      const base =
        typeof this.voiceColor === "function"
          ? this.voiceColor(voice)
          : channelColor(voice.channel ?? 0);
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
        el.style.visibility = "";
        el.style.opacity = "";
        el.style.pointerEvents = "";
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

  /**
   * Export the currently viewed sheet (voice hide + layers) as a B&W PDF.
   * @param {{fileName?: string}} [opts]
   * @returns {Promise<string>} downloaded file name
   */
  async exportBwPdf(opts = {}) {
    if (!this.hasScore()) throw new Error("No sheet music loaded");
    return exportSheetViewPdf(this.container, {
      layers: this.getLayers(),
      fileName: opts.fileName || "score.pdf",
    });
  }

  hasScore() {
    return this._ready && !!this.xml;
  }

  _cancelInlineEdit() {
    if (this._editInput) {
      this._editInput.remove();
      this._editInput = null;
    }
    this._editCtx = null;
  }

  /**
   * Make title + stave-name SVG texts clickable for inline editing.
   */
  _bindInlineEditors() {
    this._cancelInlineEdit();
    const svg = this.container.querySelector("svg");
    if (!svg || !this.xml) return;

    let meta;
    try {
      meta = readMusicXmlMeta(this.xml);
    } catch {
      return;
    }
    const pending = this._ensurePending();

    const texts = [...svg.querySelectorAll("text")];
    for (const el of texts) {
      el.classList.remove("pp-editable-text");
      el.removeAttribute("data-pp-edit");
      el.removeAttribute("data-pp-part-id");
      el.onclick = null;
    }

    const titleValue = pending.title || meta.title || "";
    if (titleValue) {
      for (const el of texts) {
        if (el.textContent?.trim() === meta.title || el.textContent?.trim() === titleValue) {
          this._markEditable(el, "title", null);
          if (pending.title && el.textContent.trim() !== pending.title) {
            el.textContent = pending.title;
          }
        }
      }
    }

    for (const part of meta.parts) {
      const currentName = pending.parts.get(part.id) || part.name;
      for (const el of texts) {
        const t = el.textContent?.trim() || "";
        if (t === part.name || t === part.abbreviation || t === currentName) {
          this._markEditable(el, "part", part.id);
          if (currentName && t !== currentName && (t === part.name || t === part.abbreviation)) {
            el.textContent = currentName;
          }
        }
      }
    }
  }

  _markEditable(el, kind, partId) {
    el.classList.add("pp-editable-text");
    el.setAttribute("data-pp-edit", kind);
    if (partId) el.setAttribute("data-pp-part-id", partId);
    el.style.cursor = "text";
    el.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._beginInlineEdit(el, kind, partId);
    };
  }

  _beginInlineEdit(svgText, kind, partId) {
    this._cancelInlineEdit();
    const rect = svgText.getBoundingClientRect();
    const parent = this.container.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const cs = getComputedStyle(this.container);
    if (cs.position === "static") this.container.style.position = "relative";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "sheet-inline-edit";
    input.value = svgText.textContent?.trim() || "";
    input.setAttribute("aria-label", kind === "title" ? "Edit title" : "Edit stave label");
    const left = rect.left - parent.left + this.container.scrollLeft;
    const top = rect.top - parent.top + this.container.scrollTop;
    input.style.left = `${Math.max(0, left - 4)}px`;
    input.style.top = `${Math.max(0, top - 2)}px`;
    input.style.width = `${Math.max(80, rect.width + 24)}px`;
    input.style.fontSize = `${Math.max(12, rect.height * 0.85)}px`;

    this.container.appendChild(input);
    this._editInput = input;
    this._editCtx = { svgText, kind, partId, original: input.value };
    input.focus();
    input.select();

    const commit = () => this._commitInlineEdit();
    const cancel = () => {
      if (this._editCtx) this._editCtx.svgText.textContent = this._editCtx.original;
      this._cancelInlineEdit();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", () => commit());
  }

  _commitInlineEdit() {
    if (!this._editInput || !this._editCtx) return;
    const { kind, partId, original, svgText } = this._editCtx;
    const next = this._editInput.value.trim();
    this._cancelInlineEdit();
    if (!next || next === original) {
      if (svgText) svgText.textContent = original;
      return;
    }

    const pending = this._ensurePending();
    if (kind === "title") {
      pending.title = next;
      for (const el of this.container.querySelectorAll('text[data-pp-edit="title"]')) {
        el.textContent = next;
      }
    } else if (kind === "part" && partId) {
      this.renamePart(partId, next, { notify: true });
      return;
    }
    this._setDirty(true);
  }
}

export { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT };
