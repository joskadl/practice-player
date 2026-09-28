/**
 * Insert / manage MusicXML harmonies (chords) and direction words (text notes).
 * Layer visibility prefs live in identification/miscellaneous.
 */

const LAYERS_FIELD = "practice-player-layers";
/** Distinct colour OSMD paints on practice text notes so we can CSS-tag them. */
export const PRACTICE_NOTE_COLOR = "#1a6b5c";

const DEFAULT_LAYERS = {
  staves: true,
  lyrics: true,
  chords: true,
  notes: true,
};

function localName(el) {
  return el?.localName || el?.tagName?.replace(/^.*:/, "") || "";
}

function childrenByName(parent, name) {
  if (!parent) return [];
  return [...parent.children].filter((el) => localName(el) === name);
}

function firstChild(parent, name) {
  return childrenByName(parent, name)[0] || null;
}

function ensureChild(parent, name, doc) {
  let el = firstChild(parent, name);
  if (el) return el;
  el = doc.createElement(name);
  parent.appendChild(el);
  return el;
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function readMiscField(root, name) {
  const identification = firstChild(root, "identification");
  if (!identification) return null;
  const misc = firstChild(identification, "miscellaneous");
  if (!misc) return null;
  for (const field of childrenByName(misc, "miscellaneous-field")) {
    if (field.getAttribute("name") === name) return field.textContent?.trim() || "";
  }
  return null;
}

function writeMiscField(root, doc, name, value) {
  let identification = firstChild(root, "identification");
  if (!identification) {
    identification = doc.createElement("identification");
    const before = firstChild(root, "defaults") || firstChild(root, "part-list");
    root.insertBefore(identification, before);
  }
  const misc = ensureChild(identification, "miscellaneous", doc);
  let field = null;
  for (const el of childrenByName(misc, "miscellaneous-field")) {
    if (el.getAttribute("name") === name) {
      field = el;
      break;
    }
  }
  if (!field) {
    field = doc.createElement("miscellaneous-field");
    field.setAttribute("name", name);
    misc.appendChild(field);
  }
  setText(field, value);
}

function parseDoc(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid MusicXML");
  return doc;
}

function serializeDoc(doc) {
  const serialized = new XMLSerializer().serializeToString(doc);
  if (serialized.startsWith("<?xml")) return serialized;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

/**
 * @returns {{staves:boolean, lyrics:boolean, chords:boolean, notes:boolean}}
 */
export function readAnnotationLayers(xmlText) {
  try {
    const doc = parseDoc(xmlText);
    const raw = readMiscField(doc.documentElement, LAYERS_FIELD);
    if (!raw) return { ...DEFAULT_LAYERS };
    const parsed = JSON.parse(raw);
    return {
      staves: parsed.staves !== false,
      lyrics: parsed.lyrics !== false,
      chords: parsed.chords !== false,
      notes: parsed.notes !== false,
    };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

/**
 * @param {string} xmlText
 * @param {{staves?:boolean, lyrics?:boolean, chords?:boolean, notes?:boolean}} layers
 */
export function writeAnnotationLayers(xmlText, layers) {
  const doc = parseDoc(xmlText);
  const next = { ...readAnnotationLayers(xmlText), ...layers };
  writeMiscField(doc.documentElement, doc, LAYERS_FIELD, JSON.stringify(next));
  return serializeDoc(doc);
}

/**
 * Parse a free-text chord symbol into MusicXML root + kind.
 * @param {string} raw
 */
export function parseChordSymbol(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const m = text.match(/^([A-Ga-g])([#b♯♭]?)(.*)$/);
  if (!m) {
    return { rootStep: "C", rootAlter: 0, kind: "other", kindText: text };
  }
  const rootStep = m[1].toUpperCase();
  const acc = m[2];
  const rootAlter = acc === "#" || acc === "♯" ? 1 : acc === "b" || acc === "♭" ? -1 : 0;
  const rest = (m[3] || "").trim().toLowerCase();
  let kind = "major";
  if (!rest) kind = "major";
  else if (rest === "m" || rest === "min" || rest === "mi" || rest === "-" || /^m(?!aj)/.test(rest))
    kind = "minor";
  else if (/^(dim|o)/.test(rest)) kind = "diminished";
  else if (/^(aug|\+)/.test(rest)) kind = "augmented";
  else if (/^(7|9|11|13|dom)/.test(rest)) kind = "dominant";
  else if (/^(maj|Δ|△)/.test(rest)) kind = "major-seventh";
  else if (/^sus/.test(rest)) kind = "suspended-fourth";
  else kind = "other";
  return { rootStep, rootAlter, kind, kindText: text };
}

/**
 * Locate the insert point in a part at the note onset for ``tick``.
 * Harmony / direction is inserted immediately before that note so OSMD
 * renders it at the same musical position as the playhead.
 * @returns {{ partEl: Element, measureEl: Element, beforeNode: ChildNode|null, divisions: number }|null}
 */
function locateInsertPoint(doc, tick, partId) {
  const root = doc.documentElement;
  const parts = childrenByName(root, "part");
  if (!parts.length) return null;
  let partEl = parts[0];
  if (partId) {
    const found = parts.find((p) => p.getAttribute("id") === partId);
    if (found) partEl = found;
  }

  const target = Math.max(0, tick | 0);
  let absTick = 0;
  let divisions = 480;
  let beats = 4;
  let beatType = 4;
  /** @type {{ el: Element, start: number, measureEl: Element, divisions: number }[]} */
  const candidates = [];
  const measures = childrenByName(partEl, "measure");

  // Mirror musicxml-parse.js measure timeline so playhead ticks match note onsets
  // (including pickup / incomplete measures that pad to the written time signature).
  for (const measure of measures) {
    const measureStart = absTick;
    let cursor = measureStart;

    for (const child of [...measure.childNodes]) {
      if (child.nodeType !== 1) continue;
      const el = /** @type {Element} */ (child);
      const tag = localName(el);

      if (tag === "attributes") {
        const d = Number(firstChild(el, "divisions")?.textContent || 0);
        if (d > 0) divisions = d;
        const timeEl = firstChild(el, "time");
        if (timeEl) {
          const b = Number(firstChild(timeEl, "beats")?.textContent || 0);
          const bt = Number(firstChild(timeEl, "beat-type")?.textContent || 0);
          if (b > 0) beats = b;
          if (bt > 0) beatType = bt;
        }
        continue;
      }
      if (tag === "backup") {
        cursor -= Number(firstChild(el, "duration")?.textContent || 0);
        if (cursor < measureStart) cursor = measureStart;
        continue;
      }
      if (tag === "forward") {
        cursor += Number(firstChild(el, "duration")?.textContent || 0);
        continue;
      }
      if (tag !== "note") continue;

      const isChord = !!firstChild(el, "chord");
      const isGrace = !!firstChild(el, "grace");
      const isRest = !!firstChild(el, "rest");
      const dur = isGrace ? 0 : Number(firstChild(el, "duration")?.textContent || 0);
      const start = cursor;
      if (!isGrace && !isRest) {
        candidates.push({ el, start, measureEl: measure, divisions });
      }
      if (!isChord) cursor += dur;
    }
    const measureLen = Math.max(1, Math.round(divisions * beats * (4 / beatType)));
    absTick = measureStart + measureLen;
  }

  if (!candidates.length) {
    const last = measures[measures.length - 1];
    if (!last) return null;
    return { partEl, measureEl: last, beforeNode: null, divisions };
  }

  // Prefer the pitched note that starts exactly at the playhead onset.
  let chosen =
    candidates.find((c) => c.start === target) ||
    [...candidates].reverse().find((c) => c.start <= target) ||
    candidates.find((c) => c.start > target) ||
    null;

  if (!chosen) {
    const last = measures[measures.length - 1];
    return { partEl, measureEl: last, beforeNode: null, divisions };
  }
  return {
    partEl,
    measureEl: chosen.measureEl,
    beforeNode: chosen.el,
    divisions: chosen.divisions,
  };
}

function buildHarmonyEl(doc, chordText) {
  const parsed = parseChordSymbol(chordText);
  if (!parsed) return null;
  const harmony = doc.createElement("harmony");
  harmony.setAttribute("color", "#334155");
  const root = doc.createElement("root");
  const step = doc.createElement("root-step");
  setText(step, parsed.rootStep);
  root.appendChild(step);
  if (parsed.rootAlter) {
    const alter = doc.createElement("root-alter");
    setText(alter, String(parsed.rootAlter));
    root.appendChild(alter);
  }
  harmony.appendChild(root);
  const kind = doc.createElement("kind");
  kind.setAttribute("text", parsed.kindText);
  setText(kind, parsed.kind);
  harmony.appendChild(kind);
  return harmony;
}

function buildDirectionWordsEl(doc, text) {
  const direction = doc.createElement("direction");
  direction.setAttribute("placement", "above");
  const dtype = doc.createElement("direction-type");
  const words = doc.createElement("words");
  words.setAttribute("font-style", "italic");
  words.setAttribute("color", PRACTICE_NOTE_COLOR);
  words.setAttribute("font-size", "10.5");
  words.setAttribute("xml:id", `pp-note-${Date.now().toString(36)}`);
  setText(words, text);
  dtype.appendChild(words);
  direction.appendChild(dtype);
  return direction;
}

/**
 * @param {string} xmlText
 * @param {number} tick
 * @param {string} chordText
 * @param {{partId?: string}} [opts]
 */
export function insertHarmonyAtTick(xmlText, tick, chordText, opts = {}) {
  const doc = parseDoc(xmlText);
  const loc = locateInsertPoint(doc, tick, opts.partId);
  if (!loc) throw new Error("Could not find insert position for chord");
  const el = buildHarmonyEl(doc, chordText);
  if (!el) throw new Error("Empty chord symbol");
  if (loc.beforeNode) loc.measureEl.insertBefore(el, loc.beforeNode);
  else loc.measureEl.appendChild(el);
  return serializeDoc(doc);
}

/**
 * @param {string} xmlText
 * @param {number} tick
 * @param {string} text
 * @param {{partId?: string}} [opts]
 */
export function insertDirectionWordsAtTick(xmlText, tick, text, opts = {}) {
  const note = String(text || "").trim();
  if (!note) throw new Error("Empty note text");
  const doc = parseDoc(xmlText);
  const loc = locateInsertPoint(doc, tick, opts.partId);
  if (!loc) throw new Error("Could not find insert position for note");
  const el = buildDirectionWordsEl(doc, note);
  if (loc.beforeNode) loc.measureEl.insertBefore(el, loc.beforeNode);
  else loc.measureEl.appendChild(el);
  return serializeDoc(doc);
}

export { DEFAULT_LAYERS, LAYERS_FIELD };
