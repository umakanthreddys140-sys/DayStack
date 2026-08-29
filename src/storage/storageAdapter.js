/**
 * DAYSTACK Storage Adapter
 * Provides an offline-first storage abstraction with IndexedDB as primary
 * storage engine and automatic migration from localStorage.
 */

const DB_NAME = 'Orvyn_DB';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';
const DEFAULT_KEY = 'lifeos_v1';

class StorageAdapter {
  constructor() {
    this.dbPromise = this.initDB();
    this.migrated = false;
  }

  /**
   * Initializes IndexedDB database and object store.
   * @returns {Promise<IDBDatabase|null>}
   */
  async initDB() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB not supported, falling back to localStorage');
      return null;
    }
    return new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (err) => {
          console.warn('IndexedDB open error, using localStorage fallback', err);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB initialization failed', err);
        resolve(null);
      }
    });
  }

  /**
   * Retrieves a value from IndexedDB (with localStorage fallback).
   * @param {string} key
   * @returns {Promise<any>}
   */
  async get(key = DEFAULT_KEY) {
    const db = await this.dbPromise;
    if (db) {
      try {
        const val = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (val !== undefined && val !== null) {
          return val;
        }
      } catch (err) {
        console.warn('IndexedDB read error, falling back to localStorage', err);
      }
    }

    // Fallback to localStorage
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('LocalStorage read error:', e);
      return null;
    }
  }

  /**
   * Sets a value in IndexedDB and syncs to localStorage.
   * @param {string} key
   * @param {any} val
   * @returns {Promise<boolean>}
   */
  async set(key = DEFAULT_KEY, val) {
    // 1. Sync to localStorage for fast synchronous reads & backward compatibility
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (err) {
      console.warn('LocalStorage save quota exceeded or blocked:', err);
    }

    // 2. Persist to IndexedDB
    const db = await this.dbPromise;
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(val, key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
        return true;
      } catch (err) {
        console.error('IndexedDB write error:', err);
        return false;
      }
    }
    return true;
  }

  /**
   * Removes a key from IndexedDB and localStorage.
   * @param {string} key
   */
  async remove(key = DEFAULT_KEY) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}

    const db = await this.dbPromise;
    if (db) {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
      } catch (err) {
        console.error('IndexedDB delete error:', err);
      }
    }
  }

  /**
   * Clears the storage.
   */
  async clear() {
    try {
      localStorage.clear();
    } catch (_) {}

    const db = await this.dbPromise;
    if (db) {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
      } catch (err) {
        console.error('IndexedDB clear error:', err);
      }
    }
  }

  /**
   * Migrates existing localStorage data to IndexedDB safely.
   * @param {string} key
   * @returns {Promise<any>} Migrated or existing state
   */
  async autoMigrate(key = DEFAULT_KEY) {
    if (this.migrated) return await this.get(key);
    this.migrated = true;

    try {
      const idbVal = await this.get(key);
      const localRaw = localStorage.getItem(key);

      if (!idbVal && localRaw) {
        // Migrate from localStorage to IndexedDB
        try {
          const localParsed = JSON.parse(localRaw);
          if (localParsed && typeof localParsed === 'object') {
            await this.set(key, localParsed);
            console.log('✅ DAYSTACK: Migrated data from localStorage to IndexedDB successfully.');
            return localParsed;
          }
        } catch (parseErr) {
          console.error('⚠️ DAYSTACK: Malformed localStorage data during migration:', parseErr);
        }
      } else if (idbVal && !localRaw) {
        // Sync back to localStorage for sync helper access
        localStorage.setItem(key, JSON.stringify(idbVal));
      }
      return idbVal || (localRaw ? JSON.parse(localRaw) : null);
    } catch (err) {
      console.warn('Migration check note:', err);
      return null;
    }
  }
}

export const storageAdapter = new StorageAdapter();

if (typeof window !== 'undefined') {
  window.StorageAdapter = StorageAdapter;
  window.storageAdapter = storageAdapter;
}
