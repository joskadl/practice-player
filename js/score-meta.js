/**
 * Shared score metadata field names for Practice Player ↔ JustPlay ↔ MuseScore.
 *
 * MuseScore stores these as Project Properties metaTags inside .mscz.
 * MusicXML uses identification/miscellaneous/miscellaneous-field — the
 * interchange format both apps read/write.
 *
 * Keep in sync with JustPlay ``core/score_meta.py``.
 */

export const JI_FILE_FIELD = "justplay-ji-file";
export const JI_MARKERS_FIELD = "justplay-ji-markers";
export const REMARKS_FIELD = "practice-player-remarks";
export const HOME_KEY_FIELD = "practice-player-home-key";
export const RECORDING_URL_FIELD = "practice-player-recording-url";
export const VOICE_COLORS_FIELD = "practice-player-voice-colors";
export const LAYERS_FIELD = "practice-player-layers";

export const SHARED_MISC_FIELDS = Object.freeze([
  JI_FILE_FIELD,
  JI_MARKERS_FIELD,
  REMARKS_FIELD,
  HOME_KEY_FIELD,
  RECORDING_URL_FIELD,
  VOICE_COLORS_FIELD,
  LAYERS_FIELD,
]);

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Upsert MusicXML miscellaneous-field entries by name (string-level, DOM-free).
 * @param {string} xmlText
 * @param {Record<string, string>} fields
 * @param {{ onlyMissing?: boolean }} [opts]
 */
export function upsertMiscFieldsInMusicXml(xmlText, fields, opts = {}) {
  if (!xmlText || !fields || !Object.keys(fields).length) return xmlText;
  let xml = String(xmlText);

  const hasField = (name) =>
    new RegExp(
      `<miscellaneous-field\\s+name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      "i",
    ).test(xml);

  const entries = Object.entries(fields).filter(([, v]) => v != null && String(v).length);
  if (!entries.length) return xml;

  for (const [name, value] of entries) {
    if (opts.onlyMissing && hasField(name)) continue;
    const fieldXml = `<miscellaneous-field name="${name}">${escapeXml(value)}</miscellaneous-field>`;
    const named = new RegExp(
      `<miscellaneous-field\\s+name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?<\\/miscellaneous-field>`,
      "i",
    );
    if (named.test(xml)) {
      xml = xml.replace(named, fieldXml);
      continue;
    }
    if (/<miscellaneous>/i.test(xml)) {
      xml = xml.replace(/<miscellaneous>/i, `<miscellaneous>\n      ${fieldXml}`);
      continue;
    }
    if (/<\/identification>/i.test(xml)) {
      xml = xml.replace(
        /<\/identification>/i,
        `    <miscellaneous>\n      ${fieldXml}\n    </miscellaneous>\n  </identification>`,
      );
      continue;
    }
    // Last resort: insert before part-list
    if (/<part-list\b/i.test(xml)) {
      xml = xml.replace(
        /<part-list\b/i,
        `<identification>\n    <miscellaneous>\n      ${fieldXml}\n    </miscellaneous>\n  </identification>\n  <part-list`,
      );
    }
  }
  return xml;
}
