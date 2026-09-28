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
