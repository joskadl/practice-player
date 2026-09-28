/**
 * IndexedDB local store for practice packs, undo stacks, and sync settings.
 */

const DB_NAME = "midi-practice-player";
const DB_VERSION = 1;
const UNDO_MAX = 30;

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("undo")) {
        db.createObjectStore("undo", { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

/**
 * @template T
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => void} fn
 */
async function withStore(storeName, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = fn(store);
  await txDone(tx);
  return result;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectRecord(record) {
  await withStore("projects", "readwrite", (store) => {
    store.put(record);
  });
}

export async function loadProjectRecord(id) {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const result = await reqToPromise(tx.objectStore("projects").get(id));
  await txDone(tx);
  return result || null;
}

export async function listProjectRecords() {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const result = await reqToPromise(tx.objectStore("projects").getAll());
  await txDone(tx);
  return result || [];
}

export async function deleteProjectRecord(id) {
  await withStore("projects", "readwrite", (store) => {
    store.delete(id);
  });
  await withStore("undo", "readwrite", (store) => {
    store.delete(id);
  });
}

/**
 * Push a pack snapshot onto the undo stack (call before applying a change).
 * @param {string} projectId
 * @param {object} packSnapshot
 */
export async function pushUndo(projectId, packSnapshot) {
  const db = await openDb();
  const tx = db.transaction("undo", "readwrite");
  const store = tx.objectStore("undo");
  const existing = (await reqToPromise(store.get(projectId))) || {
    projectId,
    stack: [],
  };
  existing.stack = [...(existing.stack || []), packSnapshot].slice(-UNDO_MAX);
  store.put(existing);
  await txDone(tx);
}

/**
 * Pop last undo snapshot, or null.
 * @param {string} projectId
 */
export async function popUndo(projectId) {
  const db = await openDb();
  const tx = db.transaction("undo", "readwrite");
  const store = tx.objectStore("undo");
  const existing = await reqToPromise(store.get(projectId));
  if (!existing?.stack?.length) {
    await txDone(tx);
    return null;
  }
  const snap = existing.stack.pop();
  store.put(existing);
  await txDone(tx);
  return snap;
}

export async function undoDepth(projectId) {
  const db = await openDb();
  const tx = db.transaction("undo", "readonly");
  const existing = await reqToPromise(tx.objectStore("undo").get(projectId));
  await txDone(tx);
  return existing?.stack?.length || 0;
}

export async function clearUndo(projectId) {
  await withStore("undo", "readwrite", (store) => {
    store.delete(projectId);
  });
}

const SETTINGS_KEY = "sync-settings";

/** @typedef {{
 *   author: string,
 *   githubOwner: string,
 *   githubRepo: string,
 *   githubPath: string,
 *   githubBranch: string,
 *   githubToken: string,
 *   remoteUrl: string,
 * }} SyncSettings */

/** @returns {SyncSettings} */
export function defaultSyncSettings() {
  return {
    author: "",
    githubOwner: "",
    githubRepo: "",
    githubPath: "shared/",
    githubBranch: "main",
    githubToken: "",
    remoteUrl: "",
  };
}

export async function loadSyncSettings() {
  try {
    const db = await openDb();
    const tx = db.transaction("meta", "readonly");
    const row = await reqToPromise(tx.objectStore("meta").get(SETTINGS_KEY));
    await txDone(tx);
    return { ...defaultSyncSettings(), ...(row?.value || {}) };
  } catch {
    return defaultSyncSettings();
  }
}

/** @param {SyncSettings} settings */
export async function saveSyncSettings(settings) {
  await withStore("meta", "readwrite", (store) => {
    store.put({ key: SETTINGS_KEY, value: { ...defaultSyncSettings(), ...settings } });
  });
}
