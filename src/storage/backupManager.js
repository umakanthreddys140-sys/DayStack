/**
 * DAYSTACK Backup & Snapshot Manager
 * Manages local snapshots (Daily, Weekly, Manual, Pre-Import safety backups)
 * allowing users to review and restore prior snapshots without data loss.
 */

import { storageAdapter } from './storageAdapter.js';

const SNAPSHOTS_KEY = 'lifeos_snapshots_v1';
const MAX_SNAPSHOTS = 20;

export class BackupManager {
  /**
   * Loads all available local snapshots.
   * @returns {Promise<Array>}
   */
  static async getSnapshots() {
    const list = await storageAdapter.get(SNAPSHOTS_KEY);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Creates a snapshot of the current state.
   * @param {object} store State to snapshot
   * @param {string} type 'daily' | 'weekly' | 'manual' | 'pre_import'
   * @param {string} label Custom description
   * @returns {Promise<object>} Created snapshot
   */
  static async createSnapshot(store, type = 'manual', label = '') {
    if (!store || typeof store !== 'object') return null;

    const snapshots = await this.getSnapshots();
    const habitCount = (store.habits || []).length;
    const taskDates = Object.keys(store.plannerData || {}).length;
    const examCount = (store.exams?.subjects || []).length;
    const financeCount = (store.finance || []).length;

    const snapshot = {
      id: 'snap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      type,
      label: label || `${type.charAt(0).toUpperCase() + type.slice(1)} Snapshot`,
      summary: {
        habits: habitCount,
        plannerDates: taskDates,
        exams: examCount,
        finance: financeCount,
        userName: store.settings?.name || store.user?.profile?.name || 'User'
      },
      data: JSON.parse(JSON.stringify(store))
    };

    // Filter out redundant automated snapshots on the same day
    const today = new Date().toISOString().slice(0, 10);
    const filtered = snapshots.filter(s => {
      if (s.type === type && (type === 'daily' || type === 'weekly')) {
        return s.timestamp.slice(0, 10) !== today;
      }
      return true;
    });

    filtered.unshift(snapshot);
    const trimmed = filtered.slice(0, MAX_SNAPSHOTS);
    await storageAdapter.set(SNAPSHOTS_KEY, trimmed);
    return snapshot;
  }

  /**
   * Auto snapshot check executed on application start.
   * Creates daily/weekly snapshots if needed.
   * @param {object} store
   */
  static async checkAutoSnapshots(store) {
    if (!store) return;
    try {
      const snapshots = await this.getSnapshots();
      const today = new Date().toISOString().slice(0, 10);
      const hasTodayDaily = snapshots.some(s => s.type === 'daily' && s.timestamp.slice(0, 10) === today);

      if (!hasTodayDaily) {
        await this.createSnapshot(store, 'daily', `Daily Auto-Backup (${today})`);
      }

      // Check weekly (if day is Sunday / day === 0 and no weekly snapshot this week)
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 0) {
        const hasWeekly = snapshots.some(s => s.type === 'weekly' && s.timestamp.slice(0, 10) === today);
        if (!hasWeekly) {
          await this.createSnapshot(store, 'weekly', `Weekly Milestone Backup (${today})`);
        }
      }
    } catch (err) {
      console.warn('Auto snapshot check note:', err);
    }
  }

  /**
   * Restores a snapshot by ID.
   * @param {string} snapshotId
   * @returns {Promise<object|null>} The restored state
   */
  static async restoreSnapshot(snapshotId) {
    const snapshots = await this.getSnapshots();
    const target = snapshots.find(s => s.id === snapshotId);
    if (!target || !target.data) return null;
    return JSON.parse(JSON.stringify(target.data));
  }

  /**
   * Deletes a snapshot by ID.
   * @param {string} snapshotId
   */
  static async deleteSnapshot(snapshotId) {
    const snapshots = await this.getSnapshots();
    const filtered = snapshots.filter(s => s.id !== snapshotId);
    await storageAdapter.set(SNAPSHOTS_KEY, filtered);
  }
}

if (typeof window !== 'undefined') {
  window.BackupManager = BackupManager;
}
