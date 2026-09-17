/**
 * Persistence for the web app.
 *
 * Two things are stored:
 *
 *   libraries  user-imported CLF documents, in IndexedDB
 *   settings   display and matching preferences, in localStorage
 *
 * Neither leaves the machine. The page has no network calls at all, which is
 * both a privacy property and the reason it works offline.
 *
 * IndexedDB is unavailable in a few configurations (some browsers restrict it
 * on file://, private windows, or hardened profiles). When that happens we fall
 * back to an in-memory store so the app still runs — imported libraries just do
 * not survive a reload, and we say so in the UI rather than failing silently.
 *
 * @module web/store
 */

const DB_NAME = 'coloroteca';
const DB_VERSION = 1;
const STORE_LIBRARIES = 'libraries';
const SETTINGS_KEY = 'coloroteca:settings';

/** @type {Map<string, object>} used when IndexedDB is not available */
const memoryFallback = new Map();

let usingFallback = false;

/**
 * Whether persistence degraded to memory. Read through a function rather than
 * the variable so bundled builds cannot capture a stale copy of it.
 * @returns {boolean}
 */
export function isUsingFallback() {
  return usingFallback;
}

/* ────────────────────────────── IndexedDB ────────────────────────────── */

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_LIBRARIES)) {
        db.createObjectStore(STORE_LIBRARIES, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  }).catch((err) => {
    // Degrade once and stay degraded — the memoised rejected promise means we
    // never retry mid-session. Every caller below catches and uses memory.
    usingFallback = true;
    throw err;
  });

  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE_LIBRARIES, mode).objectStore(STORE_LIBRARIES);
}

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/* ──────────────────────────── library records ─────────────────────────── */

/**
 * Records carry the CLF document plus a little bookkeeping. Keeping the whole
 * document means export is a straight serialisation, with no lossy rebuild.
 *
 * @typedef {object} LibraryRecord
 * @property {string} id
 * @property {string} name
 * @property {string} system
 * @property {number} count
 * @property {string} source
 * @property {string} license
 * @property {string} importedAt
 * @property {number} addedAt       epoch ms, when it landed in this browser
 * @property {string} origin        where it came from, for the manager UI
 * @property {object} doc           the CLF document
 */

function toRecord(doc, origin) {
  const meta = doc.meta ?? {};
  return {
    id: doc.id,
    name: meta.name ?? doc.id,
    system: meta.system ?? 'CUSTOM',
    count: Array.isArray(doc.colors) ? doc.colors.length : 0,
    source: meta.source ?? 'unknown',
    license: meta.license ?? 'unknown',
    importedAt: meta.importedAt ?? null,
    addedAt: Date.now(),
    origin: origin ?? 'imported',
    doc,
  };
}

/** @returns {Promise<LibraryRecord[]>} */
export async function listStoredLibraries() {
  try {
    const db = await openDb();
    const rows = await wrap(tx(db, 'readonly').getAll());
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } catch {
    return [...memoryFallback.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
  }
}

/**
 * Insert or replace a library. The id is the key, so re-importing the same
 * book overwrites rather than duplicating — which is what people expect when
 * they re-import after editing a file.
 *
 * @param {object} doc CLF document
 * @param {string} [origin]
 * @returns {Promise<LibraryRecord>}
 */
export async function putStoredLibrary(doc, origin) {
  const record = toRecord(doc, origin);
  try {
    const db = await openDb();
    await wrap(tx(db, 'readwrite').put(record));
  } catch {
    memoryFallback.set(record.id, record);
    usingFallback = true;
  }
  return record;
}

/** @returns {Promise<void>} */
export async function deleteStoredLibrary(id) {
  try {
    const db = await openDb();
    await wrap(tx(db, 'readwrite').delete(id));
  } catch {
    memoryFallback.delete(id);
  }
}

/** Remove everything the user imported, leaving built-ins untouched. */
export async function clearStoredLibraries() {
  memoryFallback.clear();
  try {
    const db = await openDb();
    await wrap(tx(db, 'readwrite').clear());
  } catch {
    /* nothing else to do */
  }
}

/* ─────────────────────────────── settings ─────────────────────────────── */

export const DEFAULT_SETTINGS = Object.freeze({
  formula: 'CIEDE2000',
  kl: 'auto',        // 'auto' | '1' | '2'
  top: 5,
  threshold: null,   // null = no cut-off
  view: 'single',    // 'single' | 'batch'
});

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode or storage full — settings simply will not persist */
  }
}
