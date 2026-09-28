/**
 * Shared practice pack: MusicXML + edits + rehearsal notes + revision history.
 * Local-first; syncable as a single JSON file (or via GitHub Contents API).
 */

export const PACK_FORMAT = "midi-practice-pack";
export const PACK_VERSION = 1;
const HISTORY_MAX = 40;

export function newId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {object} partial
 * @returns {object}
 */
export function createEmptyPack(partial = {}) {
  const now = new Date().toISOString();
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    id: partial.id || newId("proj"),
    rev: partial.rev ?? 1,
    updatedAt: now,
    author: partial.author || "",
    title: partial.title || "",
    sourceFileName: partial.sourceFileName || "",
    musicXml: partial.musicXml || "",
    edits: {
      title: partial.edits?.title ?? partial.title ?? "",
      parts: partial.edits?.parts ?? [],
      staffLines: partial.edits?.staffLines ?? 5,
      voiceColors: partial.edits?.voiceColors ?? {},
    },
    notes: Array.isArray(partial.notes) ? partial.notes : [],
    history: Array.isArray(partial.history) ? partial.history : [],
  };
}

export function isPracticePack(obj) {
  return !!(obj && obj.format === PACK_FORMAT && Number(obj.version) >= 1);
}

export function parsePracticePack(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  if (!isPracticePack(data)) throw new Error("Not a MIDI Practice Pack file");
  return normalizePack(data);
}

export function normalizePack(pack) {
  const base = createEmptyPack(pack);
  base.id = pack.id || base.id;
  base.rev = Math.max(1, Number(pack.rev) || 1);
  base.updatedAt = pack.updatedAt || base.updatedAt;
  base.author = pack.author || "";
  base.title = pack.title || base.edits.title || "";
  base.sourceFileName = pack.sourceFileName || "";
  base.musicXml = pack.musicXml || "";
  base.edits = {
    title: pack.edits?.title ?? base.title,
    parts: Array.isArray(pack.edits?.parts) ? pack.edits.parts : [],
    staffLines: pack.edits?.staffLines ?? 5,
    voiceColors:
      pack.edits?.voiceColors && typeof pack.edits.voiceColors === "object"
        ? { ...pack.edits.voiceColors }
        : {},
  };
  base.notes = Array.isArray(pack.notes)
    ? pack.notes.map((n) => ({
        id: n.id || newId("note"),
        text: String(n.text || ""),
        author: String(n.author || ""),
        updatedAt: n.updatedAt || base.updatedAt,
        tick: n.tick == null ? null : Number(n.tick),
      }))
    : [];
  base.history = Array.isArray(pack.history) ? pack.history.slice(-HISTORY_MAX) : [];
  return base;
}

/**
 * Clone pack for undo snapshots (structuredClone when available).
 * @param {object} pack
 */
export function clonePack(pack) {
  if (typeof structuredClone === "function") return structuredClone(pack);
  return JSON.parse(JSON.stringify(pack));
}

/**
 * Append a history entry and bump rev. Returns new pack (mutates copy).
 * @param {object} pack
 * @param {string} summary
 * @param {string} [author]
 */
export function bumpRevision(pack, summary, author = "") {
  const next = clonePack(pack);
  next.rev = (Number(next.rev) || 0) + 1;
  next.updatedAt = new Date().toISOString();
  if (author) next.author = author;
  next.history = [
    ...(next.history || []),
    {
      rev: next.rev,
      at: next.updatedAt,
      author: author || next.author || "",
      summary: String(summary || "Edit").slice(0, 200),
    },
  ].slice(-HISTORY_MAX);
  return next;
}

/**
 * Build pack from current player state.
 */
export function buildPackFromState({
  packId,
  rev,
  history,
  notes,
  author,
  sourceFileName,
  musicXml,
  edits,
  title,
}) {
  return normalizePack({
    id: packId,
    rev: rev ?? 1,
    history: history || [],
    notes: notes || [],
    author: author || "",
    sourceFileName: sourceFileName || "",
    musicXml: musicXml || "",
    title: title || edits?.title || "",
    edits: edits || { title: "", parts: [], staffLines: 5, voiceColors: {} },
  });
}

export function stringifyPack(pack) {
  return `${JSON.stringify(normalizePack(pack), null, 2)}\n`;
}

export function downloadPack(pack, fileName) {
  const blob = new Blob([stringifyPack(pack)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".practice.json")
    ? fileName
    : `${(fileName || "score").replace(/\.(musicxml|xml|mid|midi|practice\.json)$/i, "")}.practice.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Decide sync action given local vs remote packs.
 * @returns {"apply-remote"|"push-local"|"conflict"|"same"}
 */
export function comparePacks(local, remote) {
  if (!remote) return "push-local";
  if (!local) return "apply-remote";
  if (local.id !== remote.id) return "conflict";
  if (local.rev === remote.rev && local.updatedAt === remote.updatedAt) return "same";
  if (remote.rev > local.rev) return "apply-remote";
  if (local.rev > remote.rev) return "push-local";
  // Same rev number but different timestamps/content → conflict
  return "conflict";
}
