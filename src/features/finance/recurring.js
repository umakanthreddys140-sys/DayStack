/**
 * DAYSTACK Recurring Expenses Engine
 * Manages recurring bills, subscriptions, and financial logs.
 * and safely generates due transactions without creating duplicate entries.
 */

import { escapeHtml } from '../../utils/sanitize.js';

export class RecurringFinance {
  /**
   * Returns default sample recurring expenses if none exist.
   */
  static getDefaultRecurring() {
    return []; // No pre-filled sample data — user adds their own recurring expenses
  }

  /**
   * Processes all active recurring expenses and adds due entries into store.finance.
   * Prevents duplicates for the same month/date.
   * @param {object} store
   * @param {string} today YYYY-MM-DD
   * @returns {number} Count of newly added transactions
   */
  static processDueExpenses(store, today = new Date().toISOString().slice(0, 10)) {
    if (!store) return 0;
    if (!Array.isArray(store.recurringExpenses)) {
      store.recurringExpenses = this.getDefaultRecurring();
    }
    if (!Array.isArray(store.finance)) {
      store.finance = [];
    }

    const currentMonthStr = today.slice(0, 7); // 'YYYY-MM'
    let addedCount = 0;

    store.recurringExpenses.forEach(rec => {
      if (!rec.active) return;

      const targetDay = String(rec.dayOfMonth || 1).padStart(2, '0');
      const targetDate = `${currentMonthStr}-${targetDay}`;

      // Only generate if targetDate <= today
      if (targetDate <= today) {
        // Check if an expense entry already exists for this recurring item in this month
        const alreadyLogged = store.finance.some(f => {
          return f.date === targetDate && (f.recurringId === rec.id || f.note?.includes(rec.name));
        });

        if (!alreadyLogged) {
          store.finance.push({
            id: 'fin_rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            type: 'expense',
            date: targetDate,
            category: rec.category || 'other',
            amount: Number(rec.amount) || 0,
            note: `[Recurring] ${rec.name}`,
            recurringId: rec.id
          });
          addedCount++;
        }
      }
    });

    return addedCount;
  }

  /**
   * Generates the Recurring Expenses Management HTML modal content.
   * @param {Array<object>} recurringList
   * @returns {string} HTML string
   */
  static renderModalContent(recurringList = []) {
    const list = Array.isArray(recurringList) ? recurringList : [];
    const totalMonthly = list.filter(r => r.active).reduce((s, r) => s + (Number(r.amount) || 0), 0);

    return `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="font-family:var(--font-display); font-size:16px; font-weight:700; color:var(--text-bright);">Recurring Monthly Expenses</div>
            <div class="dim" style="font-size:12px;">Auto-applied to monthly finance balance without duplication.</div>
          </div>
          <div class="pill pill-accent" style="font-size:12px; font-weight:700;">
            Total: ₹${totalMonthly.toLocaleString()}/mo
          </div>
        </div>

        <div class="table-wrap" style="max-height:300px; overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th>Expense Name</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Day of Month</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${list.length ? list.map(r => `
                <tr>
                  <td>
                    <div style="font-weight:600; color:var(--text-bright);">${escapeHtml(r.name)}</div>
                    ${r.note ? `<div class="dim" style="font-size:11px;">${escapeHtml(r.note)}</div>` : ''}
                  </td>
                  <td class="mono" style="font-weight:700; color:var(--danger);">₹${Number(r.amount).toLocaleString()}</td>
                  <td><span class="pill pill-dim">${escapeHtml(r.category)}</span></td>
                  <td class="mono">${r.dayOfMonth || 1}st</td>
                  <td>
                    <label style="cursor:pointer;">
                      <input type="checkbox" class="rec-toggle-chk" data-rec-id="${r.id}" ${r.active ? 'checked' : ''} style="accent-color:var(--accent); width:15px; height:15px;" />
                    </label>
                  </td>
                  <td>
                    <button class="btn-icon btn-icon-danger rec-del-btn" data-del-rec-id="${r.id}" title="Remove recurring expense">🗑️</button>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="6" class="dim" style="text-align:center; padding:16px;">No recurring expenses set up yet.</td></tr>`}
            </tbody>
          </table>
        </div>

        <!-- Add New Recurring Form -->
        <div style="border-top:1px solid var(--border-soft); padding-top:12px;">
          <div style="font-size:13px; font-weight:700; color:var(--text-bright); margin-bottom:8px;">+ Add New Recurring Expense</div>
          <div class="grid grid-2" style="gap:8px;">
            <input id="newRecName" placeholder="Name (e.g. Hostel Rent, Gym, Spotify)" style="padding:6px 10px; font-size:13px;" />
            <input id="newRecAmount" type="number" placeholder="Amount (₹)" style="padding:6px 10px; font-size:13px;" />
          </div>
          <div class="grid grid-2" style="gap:8px; margin-top:8px;">
            <select id="newRecCat" style="padding:6px 10px; font-size:13px;">
              <option value="rent">Rent / Hostel</option>
              <option value="food">Food / Mess</option>
              <option value="tools">Tools & Subscriptions</option>
              <option value="transport">Transport</option>
              <option value="health">Health & Fitness</option>
              <option value="education">Academics & Books</option>
              <option value="other">Other</option>
            </select>
            <input id="newRecDay" type="number" min="1" max="28" value="1" placeholder="Billing Day (1-28)" style="padding:6px 10px; font-size:13px;" />
          </div>
          <div style="margin-top:8px; display:flex; justify-content:flex-end;">
            <button class="btn btn-sm btn-accent" id="saveNewRecBtn">+ Add Recurring Item</button>
          </div>
        </div>
      </div>
    `;
  }
}

if (typeof window !== 'undefined') {
  window.RecurringFinance = RecurringFinance;
}
