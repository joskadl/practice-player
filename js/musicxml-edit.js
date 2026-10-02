/**
 * Read / patch MusicXML metadata (title, part names, staff lines) for export.
 */

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

function shortAbbr(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 8);
  return parts
    .map((p) => p.slice(0, 2))
    .join(" ")
    .slice(0, 16);
}

const VOICE_COLORS_FIELD = "practice-player-voice-colors";
const RECORDING_URL_FIELD = "practice-player-recording-url";
const REMARKS_FIELD = "practice-player-remarks";
/** Stable home key for modulation UI, e.g. "Bb major" or "A minor". */
const HOME_KEY_FIELD = "practice-player-home-key";

const STEP_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PC_SHARP = [
  ["C", 0],
  ["C", 1],
  ["D", 0],
  ["D", 1],
  ["E", 0],
  ["F", 0],
  ["F", 1],
  ["G", 0],
  ["G", 1],
  ["A", 0],
  ["A", 1],
  ["B", 0],
];
const PC_FLAT = [
  ["C", 0],
  ["D", -1],
  ["D", 0],
  ["E", -1],
  ["E", 0],
  ["F", 0],
  ["G", -1],
  ["G", 0],
  ["A", -1],
  ["A", 0],
  ["B", -1],
  ["B", 0],
];
/** Semitone up → fifths delta (prefer key signatures in −7…+7). */
const SEMI_TO_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function preferFlats(fifths) {
  return Number(fifths) < 0;
}

/** Pitch-class (0=C) for a major/minor key signature. */
export function tonicPcFromFifths(fifths, mode = "major") {
  const f = Number(fifths) || 0;
  // Circle-of-fifths major tonics from C.
  const majorPc = ((f * 7) % 12 + 12) % 12;
  if (String(mode).toLowerCase().startsWith("min")) {
    return (majorPc + 9) % 12; // relative minor
  }
  return majorPc;
}

/** Prefer a fifths value in −7…+7 for a tonic pitch class + mode. */
export function fifthsFromTonicPc(pc, mode = "major") {
  const want = ((pc % 12) + 12) % 12;
  const isMinor = String(mode).toLowerCase().startsWith("min");
  let best = 0;
  let bestDist = 99;
  for (let f = -7; f <= 7; f++) {
    const got = tonicPcFromFifths(f, isMinor ? "minor" : "major");
    if (got !== want) continue;
    const dist = Math.abs(f);
    if (dist < bestDist) {
      best = f;
      bestDist = dist;
    }
  }
  return best;
}

const PC_LABEL_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const PC_LABEL_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

function labelForPc(pc, mode, preferFlat) {
  const names = preferFlat ? PC_LABEL_FLAT : PC_LABEL_SHARP;
  const tonic = names[((pc % 12) + 12) % 12];
  const isMinor = String(mode).toLowerCase().startsWith("min");
  return `${tonic} ${isMinor ? "minor" : "major"}`;
}

/**
 * Build the 12 key-center options for a mode (same mode as the piece).
 * @param {"major"|"minor"} mode
 * @param {boolean} [preferFlat]
 */
export function keyCenterOptions(mode = "major", preferFlat = false) {
  const isMinor = String(mode).toLowerCase().startsWith("min");
  const m = isMinor ? "minor" : "major";
  const out = [];
  for (let pc = 0; pc < 12; pc++) {
    const fifths = fifthsFromTonicPc(pc, m);
    const flat = preferFlat || fifths < 0;
    out.push({
      pc,
      mode: m,
      fifths,
      label: labelForPc(pc, m, flat),
    });
  }
  return out;
}

/** @param {string} text */
export function parseKeyLabel(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const m = raw.match(/^([A-Ga-g])([#b♯♭]?)\s*(major|minor|maj|min)?$/i);
  if (!m) return null;
  const step = m[1].toUpperCase();
  const acc = m[2];
  let pc = STEP_TO_PC[step];
  if (pc == null) return null;
  if (acc === "#" || acc === "♯") pc = (pc + 1) % 12;
  if (acc === "b" || acc === "♭") pc = (pc + 11) % 12;
  const modeRaw = (m[3] || "major").toLowerCase();
  const mode = modeRaw.startsWith("min") ? "minor" : "major";
  return { pc, mode, label: labelForPc(pc, mode, acc === "b" || acc === "♭" || pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10) };
}

/**
 * Read the prevailing written key (most common first-measure key across parts).
 * @param {string} xmlText
 * @returns {{ pc: number, mode: "major"|"minor", fifths: number, label: string }|null}
 */
export function readScoreKey(xmlText) {
  try {
    const doc = parseDoc(xmlText);
    const root = doc.documentElement;
    /** @type {Map<string, number>} */
    const votes = new Map();
    for (const part of childrenByName(root, "part")) {
      const measure = childrenByName(part, "measure")[0];
      if (!measure) continue;
      const attrs = firstChild(measure, "attributes");
      const keyEl = attrs ? firstChild(attrs, "key") : null;
      if (!keyEl) continue;
      const fifths = Number(firstChild(keyEl, "fifths")?.textContent ?? 0);
      const modeRaw = (firstChild(keyEl, "mode")?.textContent || "major").trim().toLowerCase();
      const mode = modeRaw.startsWith("min") ? "minor" : "major";
      const id = `${fifths}|${mode}`;
      votes.set(id, (votes.get(id) || 0) + 1);
    }
    if (!votes.size) return null;
    let best = null;
    let bestN = -1;
    for (const [id, n] of votes) {
      if (n > bestN) {
        best = id;
        bestN = n;
      }
    }
    const [fifthsStr, mode] = best.split("|");
    const fifths = Number(fifthsStr);
    const pc = tonicPcFromFifths(fifths, mode);
    return {
      pc,
      mode: /** @type {"major"|"minor"} */ (mode),
      fifths,
      label: labelForPc(pc, mode, fifths < 0),
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} xmlText
 * @returns {{ pc: number, mode: "major"|"minor", label: string }|null}
 */
export function readHomeKey(xmlText) {
  try {
    const doc = parseDoc(xmlText);
    const raw = readMiscField(doc.documentElement, HOME_KEY_FIELD);
    const parsed = parseKeyLabel(raw || "");
    if (parsed) return parsed;
  } catch {
    /* fall through */
  }
  const score = readScoreKey(xmlText);
  if (!score) return null;
  return { pc: score.pc, mode: score.mode, label: score.label };
}

/**
 * Write / ensure a stable home-key misc field (does not change notation).
 * @param {string} xmlText
 * @param {string} [label] e.g. "G major"
 * @returns {string}
 */
export function writeHomeKey(xmlText, label) {
  const doc = parseDoc(xmlText);
  const parsed = parseKeyLabel(label) || readHomeKey(xmlText) || readScoreKey(xmlText);
  if (!parsed) return xmlText;
  writeMiscField(doc.documentElement, doc, HOME_KEY_FIELD, parsed.label);
  return serializeDoc(doc);
}

/**
 * Ensure every first-measure key has a mode, and stamp home-key if missing.
 * @param {string} xmlText
 * @param {string} [homeLabel]
 * @returns {string}
 */
export function ensureKeyMetadata(xmlText, homeLabel) {
  const doc = parseDoc(xmlText);
  const root = doc.documentElement;
  const home =
    parseKeyLabel(homeLabel || "") ||
    parseKeyLabel(readMiscField(root, HOME_KEY_FIELD) || "") ||
    readScoreKey(xmlText);
  if (!home) return xmlText;

  for (const part of childrenByName(root, "part")) {
    const measure = childrenByName(part, "measure")[0];
    if (!measure) continue;
    const attrs = firstChild(measure, "attributes");
    if (!attrs) continue;
    for (const keyEl of childrenByName(attrs, "key")) {
      let modeEl = firstChild(keyEl, "mode");
      if (!modeEl) {
        modeEl = doc.createElement("mode");
        keyEl.appendChild(modeEl);
      }
      if (!(modeEl.textContent || "").trim()) {
        setText(modeEl, home.mode);
      }
    }
  }

  writeMiscField(root, doc, HOME_KEY_FIELD, home.label);
  return serializeDoc(doc);
}

/**
 * Semitone shift that follows the circle of fifths (keeps C→G as +7, not −5).
 * @param {number} fromPc
 * @param {number} toPc
 * @param {"major"|"minor"} [mode]
 */
export function semitoneDelta(fromPc, toPc, mode = "major") {
  const fromF = fifthsFromTonicPc(fromPc, mode);
  const toF = fifthsFromTonicPc(toPc, mode);
  let df = toF - fromF;
  while (df > 6) df -= 12;
  while (df < -6) df += 12;
  let d = df * 7;
  while (d > 11) d -= 12;
  while (d < -11) d += 12;
  return d;
}

function midiToStepAlter(midi, flats) {
  const pc = ((midi % 12) + 12) % 12;
  const [step, alter] = (flats ? PC_FLAT : PC_SHARP)[pc];
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}

function pitchElToMidi(pitchEl) {
  if (!pitchEl) return null;
  const step = (firstChild(pitchEl, "step")?.textContent || "").trim().toUpperCase();
  const octave = Number(firstChild(pitchEl, "octave")?.textContent ?? 4);
  const alter = Number(firstChild(pitchEl, "alter")?.textContent ?? 0);
  const pc = STEP_TO_PC[step];
  if (pc == null || !Number.isFinite(octave)) return null;
  return (octave + 1) * 12 + pc + Math.round(alter || 0);
}

function writePitchEl(pitchEl, doc, step, alter, octave) {
  setText(ensureChild(pitchEl, "step", doc), step);
  setText(ensureChild(pitchEl, "octave", doc), String(octave));
  let alterEl = firstChild(pitchEl, "alter");
  if (alter) {
    if (!alterEl) {
      alterEl = doc.createElement("alter");
      const after = firstChild(pitchEl, "step");
      pitchEl.insertBefore(alterEl, after?.nextSibling || null);
    }
    setText(alterEl, String(alter));
  } else if (alterEl) {
    alterEl.remove();
  }
}

function accidentalName(alter) {
  if (alter === 2) return "double-sharp";
  if (alter === 1) return "sharp";
  if (alter === -1) return "flat";
  if (alter === -2) return "flat-flat";
  return "natural";
}

function transposeFifths(fifths, semitones) {
  const n = ((semitones % 12) + 12) % 12;
  let next = Number(fifths) + SEMI_TO_FIFTHS[n];
  while (next > 7) next -= 12;
  while (next < -7) next += 12;
  return next;
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

/**
 * @param {string} xmlText
 * @returns {{
 *   title: string,
 *   parts: {id:string, name:string, abbreviation:string}[],
 *   staffLines: number,
 *   voiceColors: Record<string, string>,
 * }}
 */
export function readMusicXmlMeta(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid MusicXML");
  }
  const root = doc.documentElement;

  let title =
    firstChild(root, "movement-title")?.textContent?.trim() ||
    firstChild(root, "work")?.getElementsByTagName("work-title")?.[0]?.textContent?.trim() ||
    "";

  if (!title) {
    for (const credit of childrenByName(root, "credit")) {
      const type = firstChild(credit, "credit-type")?.textContent?.trim();
      if (type === "title") {
        title = firstChild(credit, "credit-words")?.textContent?.trim() || "";
        if (title) break;
      }
    }
  }

  const parts = [];
  const partList = firstChild(root, "part-list");
  for (const sp of childrenByName(partList, "score-part")) {
    parts.push({
      id: sp.getAttribute("id") || `P${parts.length + 1}`,
      name: firstChild(sp, "part-name")?.textContent?.trim() || `Part ${parts.length + 1}`,
      abbreviation: firstChild(sp, "part-abbreviation")?.textContent?.trim() || "",
    });
  }

  let staffLines = 5;
  const firstPart = childrenByName(root, "part")[0];
  const firstMeasure = firstPart ? childrenByName(firstPart, "measure")[0] : null;
  const attrs = firstMeasure ? firstChild(firstMeasure, "attributes") : null;
  const details = attrs ? firstChild(attrs, "staff-details") : null;
  const linesEl = details ? firstChild(details, "staff-lines") : null;
  if (linesEl) {
    const n = Number(linesEl.textContent);
    if (Number.isFinite(n)) staffLines = n;
  }

  /** @type {Record<string, string>} */
  let voiceColors = {};
  const rawColors = readMiscField(root, VOICE_COLORS_FIELD);
  if (rawColors) {
    try {
      const parsed = JSON.parse(rawColors);
      if (parsed && typeof parsed === "object") voiceColors = parsed;
    } catch {
      /* ignore bad JSON */
    }
  }

  return { title, parts, staffLines, voiceColors };
}

/**
 * @param {string} xmlText
 * @param {{
 *   title?: string,
 *   parts?: {id:string, name:string, abbreviation?:string}[],
 *   staffLines?: number,
 *   voiceColors?: Record<string, string>,
 * }} edits
 * @returns {string}
 */
export function applyMusicXmlEdits(xmlText, edits) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid MusicXML");
  }
  const root = doc.documentElement;

  if (edits.title != null) {
    const title = String(edits.title);
    let movement = firstChild(root, "movement-title");
    if (!movement) {
      movement = doc.createElement("movement-title");
      const before = firstChild(root, "identification") || firstChild(root, "part-list");
      root.insertBefore(movement, before);
    }
    setText(movement, title);

    const work = firstChild(root, "work");
    if (work) {
      const workTitle = ensureChild(work, "work-title", doc);
      setText(workTitle, title);
    }

    for (const credit of childrenByName(root, "credit")) {
      const type = firstChild(credit, "credit-type")?.textContent?.trim();
      if (type === "title") {
        const words = firstChild(credit, "credit-words");
        if (words) setText(words, title);
      }
    }
  }

  if (Array.isArray(edits.parts)) {
    const partList = firstChild(root, "part-list");
    const byId = new Map(edits.parts.map((p) => [p.id, p]));
    for (const sp of childrenByName(partList, "score-part")) {
      const id = sp.getAttribute("id");
      const patch = byId.get(id);
      if (!patch) continue;
      const nameEl = ensureChild(sp, "part-name", doc);
      setText(nameEl, patch.name);
      const abbr =
        patch.abbreviation != null && String(patch.abbreviation).trim() !== ""
          ? String(patch.abbreviation).trim()
          : shortAbbr(patch.name);
      const abbrEl = ensureChild(sp, "part-abbreviation", doc);
      setText(abbrEl, abbr);
    }
  }

  if (edits.staffLines != null && Number.isFinite(edits.staffLines)) {
    const lines = Math.max(0, Math.min(5, edits.staffLines | 0));
    for (const part of childrenByName(root, "part")) {
      const measure = childrenByName(part, "measure")[0];
      if (!measure) continue;
      let attrs = firstChild(measure, "attributes");
      if (!attrs) {
        attrs = doc.createElement("attributes");
        measure.insertBefore(attrs, measure.firstChild);
      }
      const details = ensureChild(attrs, "staff-details", doc);
      const linesEl = ensureChild(details, "staff-lines", doc);
      setText(linesEl, String(lines));
    }

    // Soft hint for engravers that honour appearance widths.
    const defaults = firstChild(root, "defaults");
    if (defaults) {
      const appearance = ensureChild(defaults, "appearance", doc);
      let staffWidth = null;
      for (const lw of childrenByName(appearance, "line-width")) {
        if (lw.getAttribute("type") === "staff") {
          staffWidth = lw;
          break;
        }
      }
      if (!staffWidth) {
        staffWidth = doc.createElement("line-width");
        staffWidth.setAttribute("type", "staff");
        appearance.appendChild(staffWidth);
      }
      setText(staffWidth, lines === 0 ? "0" : "1.1");
    }
  }

  if (edits.voiceColors && typeof edits.voiceColors === "object") {
    writeMiscField(root, doc, VOICE_COLORS_FIELD, JSON.stringify(edits.voiceColors));
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  if (serialized.startsWith("<?xml")) return serialized;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

/**
 * Transpose pitched notes, key signatures, and harmony roots by ``semitones``.
 * Lyrics and direction text are left unchanged. JustPlay JI marker MIDI numbers
 * (when present) are shifted by the same amount.
 * @param {string} xmlText
 * @param {number} semitones
 * @returns {string}
 */
export function transposeMusicXml(xmlText, semitones) {
  const n = Math.round(Number(semitones) || 0);
  if (!n) return xmlText;
  const doc = parseDoc(xmlText);
  const root = doc.documentElement;

  // Collect key fifths as we walk (default C major).
  let currentFifths = 0;
  for (const part of childrenByName(root, "part")) {
    currentFifths = 0;
    for (const measure of childrenByName(part, "measure")) {
      for (const child of [...measure.children]) {
        const tag = localName(child);
        if (tag === "attributes") {
          for (const keyEl of childrenByName(child, "key")) {
            const fifthsEl = firstChild(keyEl, "fifths");
            if (fifthsEl) {
              const prev = Number(fifthsEl.textContent || 0);
              const next = transposeFifths(prev, n);
              setText(fifthsEl, String(next));
              currentFifths = next;
            }
          }
          continue;
        }
        if (tag === "note") {
          const pitchEl = firstChild(child, "pitch");
          if (!pitchEl) continue;
          const midi = pitchElToMidi(pitchEl);
          if (midi == null) continue;
          const nextMidi = midi + n;
          if (nextMidi < 0 || nextMidi > 127) continue;
          const flats = preferFlats(currentFifths);
          const { step, alter, octave } = midiToStepAlter(nextMidi, flats);
          writePitchEl(pitchEl, doc, step, alter, octave);
          const accEl = firstChild(child, "accidental");
          if (accEl) setText(accEl, accidentalName(alter));
          continue;
        }
        if (tag === "harmony") {
          const rootEl = firstChild(child, "root");
          if (!rootEl) continue;
          const stepEl = firstChild(rootEl, "root-step");
          if (!stepEl) continue;
          const step = (stepEl.textContent || "").trim().toUpperCase();
          const alter = Number(firstChild(rootEl, "root-alter")?.textContent ?? 0);
          const pc = STEP_TO_PC[step];
          if (pc == null) continue;
          const midi = 60 + pc + Math.round(alter || 0); // spelling reference octave
          const flats = preferFlats(currentFifths);
          const spelled = midiToStepAlter(midi + n, flats);
          setText(stepEl, spelled.step);
          let alterEl = firstChild(rootEl, "root-alter");
          if (spelled.alter) {
            if (!alterEl) {
              alterEl = doc.createElement("root-alter");
              rootEl.appendChild(alterEl);
            }
            setText(alterEl, String(spelled.alter));
          } else if (alterEl) {
            alterEl.remove();
          }
          // Keep kind@text in sync when it starts with the old root letter.
          const kind = firstChild(child, "kind");
          const kindText = kind?.getAttribute("text");
          if (kind && kindText) {
            const m = kindText.match(/^([A-Ga-g])([#b♯♭]?)(.*)$/);
            if (m) {
              const acc =
                spelled.alter === 1 ? "#" : spelled.alter === -1 ? "b" : spelled.alter === 2 ? "##" : spelled.alter === -2 ? "bb" : "";
              kind.setAttribute("text", `${spelled.step}${acc}${m[3] || ""}`);
            }
          }
        }
      }
    }
  }

  // Shift JustPlay JI marker MIDI note numbers when present.
  for (const fieldName of ["justplay-ji-file", "justplay-ji-markers"]) {
    const raw = readMiscField(root, fieldName);
    if (!raw) continue;
    try {
      if (fieldName === "justplay-ji-file") {
        const data = JSON.parse(raw);
        if (data && typeof data === "object" && data.refNote != null) {
          data.refNote = Number(data.refNote) + n;
          writeMiscField(root, doc, fieldName, JSON.stringify(data));
        }
      } else {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (!item || typeof item !== "object") continue;
          if (item.midi != null) item.midi = Number(item.midi) + n;
          if (item.note != null) item.note = Number(item.note) + n;
          if (item.refNote != null) item.refNote = Number(item.refNote) + n;
          if (item.metadata && typeof item.metadata === "object") {
            if (item.metadata.refNote != null) {
              item.metadata.refNote = Number(item.metadata.refNote) + n;
            }
            if (item.metadata.midi != null) {
              item.metadata.midi = Number(item.metadata.midi) + n;
            }
          }
        }
        writeMiscField(root, doc, fieldName, JSON.stringify(list));
      }
    } catch {
      /* leave broken JSON alone */
    }
  }

  return serializeDoc(doc);
}

/**
 * @param {string} xmlText
 * @returns {string}
 */
export function readRecordingUrl(xmlText) {
  try {
    const doc = parseDoc(xmlText);
    return readMiscField(doc.documentElement, RECORDING_URL_FIELD) || "";
  } catch {
    return "";
  }
}

/**
 * @param {string} xmlText
 * @param {string} url
 * @returns {string}
 */
export function writeRecordingUrl(xmlText, url) {
  const doc = parseDoc(xmlText);
  const value = String(url || "").trim();
  if (!value) {
    // Clear field if present.
    const identification = firstChild(doc.documentElement, "identification");
    const misc = identification ? firstChild(identification, "miscellaneous") : null;
    if (misc) {
      for (const field of [...childrenByName(misc, "miscellaneous-field")]) {
        if (field.getAttribute("name") === RECORDING_URL_FIELD) field.remove();
      }
    }
  } else {
    writeMiscField(doc.documentElement, doc, RECORDING_URL_FIELD, value);
  }
  return serializeDoc(doc);
}

/**
 * @param {string} xmlText
 * @returns {string}
 */
export function readRemarks(xmlText) {
  try {
    const doc = parseDoc(xmlText);
    return readMiscField(doc.documentElement, REMARKS_FIELD) || "";
  } catch {
    return "";
  }
}

/**
 * @param {string} xmlText
 * @param {string} remarks
 * @returns {string}
 */
export function writeRemarks(xmlText, remarks) {
  const doc = parseDoc(xmlText);
  const value = String(remarks ?? "");
  if (!value.trim()) {
    const identification = firstChild(doc.documentElement, "identification");
    const misc = identification ? firstChild(identification, "miscellaneous") : null;
    if (misc) {
      for (const field of [...childrenByName(misc, "miscellaneous-field")]) {
        if (field.getAttribute("name") === REMARKS_FIELD) field.remove();
      }
    }
  } else {
    writeMiscField(doc.documentElement, doc, REMARKS_FIELD, value);
  }
  return serializeDoc(doc);
}

/** Credit types that usually name people (not the piece title). */
const PERSONAL_CREDIT_TYPES = new Set([
  "composer",
  "lyricist",
  "arranger",
  "translator",
  "poet",
  "librettist",
  "transcriber",
  "encoder",
]);

/**
 * Strip personal name metadata from MusicXML (creators, person credits).
 * Safe for example scores: keeps work/part titles and encoding software.
 * @param {string} xmlText
 * @returns {string}
 */
export function stripPersonalNames(xmlText) {
  const doc = parseDoc(xmlText);
  const root = doc.documentElement;
  const identification = firstChild(root, "identification");
  if (identification) {
    for (const name of ["creator", "rights", "source"]) {
      for (const el of [...childrenByName(identification, name)]) el.remove();
    }
  }
  for (const credit of [...childrenByName(root, "credit")]) {
    const type = firstChild(credit, "credit-type")?.textContent?.trim().toLowerCase();
    if (!type || PERSONAL_CREDIT_TYPES.has(type)) credit.remove();
  }
  return serializeDoc(doc);
}

/**
 * Trigger a browser download of MusicXML text.
 * @param {string} xmlText
 * @param {string} [fileName]
 */
export function downloadMusicXml(xmlText, fileName = "score.musicxml") {
  const blob = new Blob([xmlText], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".musicxml") || fileName.endsWith(".xml")
    ? fileName
    : `${fileName}.musicxml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { RECORDING_URL_FIELD, REMARKS_FIELD, HOME_KEY_FIELD };
