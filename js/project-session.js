/**
 * Session glue: keep a practice pack in sync with local IndexedDB + undo.
 */

import {
  buildPackFromState,
  bumpRevision,
  clonePack,
  normalizePack,
  newId,
} from "./practice-pack.js";
import {
  clearUndo,
  loadProjectRecord,
  popUndo,
  pushUndo,
  saveProjectRecord,
  undoDepth,
} from "./local-store.js";

export class ProjectSession {
  constructor() {
    this.pack = null;
    this.remoteSha = null;
    this.syncedRev = null;
    this.localDirty = false;
  }

  hasPack() {
    return !!this.pack;
  }

  /**
   * Start or replace session from a loaded score.
   */
  async startFromScore({
    musicXml,
    sourceFileName,
    edits,
    title,
    author,
    notes = [],
  }) {
    const existingId = this.pack?.id;
    this.pack = buildPackFromState({
      packId: existingId || newId("proj"),
      rev: 1,
      history: [
        {
          rev: 1,
          at: new Date().toISOString(),
          author: author || "",
          summary: `Opened ${sourceFileName || "score"}`,
        },
      ],
      notes,
      author: author || "",
      sourceFileName: sourceFileName || "",
      musicXml: musicXml || "",
      edits,
      title,
    });
    this.remoteSha = null;
    this.syncedRev = null;
    this.localDirty = false;
    await clearUndo(this.pack.id);
    await this.persist();
    return this.pack;
  }

  async loadFromPack(pack, { remoteSha = null, clearUndoStack = true } = {}) {
    this.pack = normalizePack(pack);
    this.remoteSha = remoteSha;
    this.syncedRev = this.pack.rev;
    this.localDirty = false;
    if (clearUndoStack) await clearUndo(this.pack.id);
    await this.persist();
    return this.pack;
  }

  async restoreLocal(projectId) {
    const row = await loadProjectRecord(projectId);
    if (!row?.pack) return null;
    this.pack = normalizePack(row.pack);
    this.remoteSha = row.remoteSha || null;
    this.syncedRev = row.syncedRev ?? null;
    this.localDirty = !!row.localDirty;
    return this.pack;
  }

  /**
   * Snapshot undo, apply mutator, bump revision, persist.
   * @param {string} summary
   * @param {(pack: object) => void} mutator
   * @param {string} [author]
   */
  async commit(summary, mutator, author = "") {
    if (!this.pack) throw new Error("No active project");
    await pushUndo(this.pack.id, clonePack(this.pack));
    const draft = clonePack(this.pack);
    mutator(draft);
    this.pack = bumpRevision(draft, summary, author || draft.author);
    this.localDirty = true;
    await this.persist();
    return this.pack;
  }

  /**
   * Update edits/musicXml without forcing a user-facing history bump when
   * called from continuous UI — use commit() for named history steps.
   * Still persists locally for crash-safety.
   */
  async autosaveFields({ musicXml, edits, title, sourceFileName, notes }) {
    if (!this.pack) return null;
    if (musicXml != null) this.pack.musicXml = musicXml;
    if (edits) this.pack.edits = { ...this.pack.edits, ...edits };
    if (title != null) {
      this.pack.title = title;
      this.pack.edits.title = title;
    }
    if (sourceFileName != null) this.pack.sourceFileName = sourceFileName;
    if (notes) this.pack.notes = notes;
    this.pack.updatedAt = new Date().toISOString();
    this.localDirty = true;
    await this.persist();
    return this.pack;
  }

  async undo() {
    if (!this.pack) return null;
    const prev = await popUndo(this.pack.id);
    if (!prev) return null;
    this.pack = normalizePack(prev);
    this.localDirty = true;
    await this.persist();
    return this.pack;
  }

  async undoCount() {
    if (!this.pack) return 0;
    return undoDepth(this.pack.id);
  }

  markSynced({ sha = null } = {}) {
    if (!this.pack) return;
    this.syncedRev = this.pack.rev;
    this.remoteSha = sha || this.remoteSha;
    this.localDirty = false;
  }

  needsPush() {
    if (!this.pack) return false;
    if (this.localDirty) return true;
    if (this.syncedRev == null) return true;
    return this.pack.rev > this.syncedRev;
  }

  async persist() {
    if (!this.pack) return;
    await saveProjectRecord({
      id: this.pack.id,
      pack: this.pack,
      remoteSha: this.remoteSha,
      syncedRev: this.syncedRev,
      localDirty: this.localDirty,
      updatedAt: this.pack.updatedAt,
    });
  }
}
