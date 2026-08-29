/**
 * DAYSTACK College Attendance Safety & Bunk Calculator
 * Computes live attendance margins and bunk allowances for academic classes.
 */

import { escapeHtml } from '../../utils/sanitize.js';

export class AttendanceCalculator {
  /**
   * Calculates attendance summary for a given subject.
   * @param {object} store DAYSTACK Store object
   * @param {number} targetThreshold Target percentage (e.g. 75, 80, 85, 90)
   * @returns {Array<object>} Subject attendance statistics
   */
  static calculateSubjectStats(store, targetThreshold = 75) {
    if (!store || !store.college) return [];

    const schedules = store.college.schedules || {};
    const defaultClasses = store.college.defaultClasses || [];
    const subjectsMap = {};

    // Initialize with known default classes
    defaultClasses.forEach(c => {
      if (c.subject && !subjectsMap[c.subject]) {
        subjectsMap[c.subject] = {
          subject: c.subject,
          faculty: c.faculty || '',
          room: c.room || '',
          attended: 0,
          absent: 0,
          cancelled: 0,
          upcoming: 0,
          totalLogged: 0
        };
      }
    });

    // Scan all logged schedule dates
    Object.values(schedules).forEach(sched => {
      (sched.classes || []).forEach(c => {
        const sub = c.subject;
        if (!sub) return;
        if (!subjectsMap[sub]) {
          subjectsMap[sub] = {
            subject: sub,
            faculty: c.faculty || '',
            room: c.room || '',
            attended: 0,
            absent: 0,
            cancelled: 0,
            upcoming: 0,
            totalLogged: 0
          };
        }
        if (c.attendance === 'Present') {
          subjectsMap[sub].attended++;
          subjectsMap[sub].totalLogged++;
        } else if (c.attendance === 'Absent') {
          subjectsMap[sub].absent++;
          subjectsMap[sub].totalLogged++;
        } else if (c.attendance === 'Cancelled') {
          subjectsMap[sub].cancelled++;
        } else {
          subjectsMap[sub].upcoming++;
        }
      });
    });

    const targetDecimal = targetThreshold / 100;

    return Object.values(subjectsMap).map(s => {
      const conducted = s.attended + s.absent;
      // Default baseline for new subjects without logs
      const effectiveConducted = conducted > 0 ? conducted : 10;
      const effectiveAttended = conducted > 0 ? s.attended : 8;

      const currentPct = conducted > 0
        ? Math.round((s.attended / conducted) * 1000) / 10
        : 80.0;

      let safeBunks = 0;
      let requiredToAttend = 0;

      if (currentPct >= targetThreshold) {
        // Safe bunks formula: floor((A - T * N) / T)
        safeBunks = Math.max(0, Math.floor((effectiveAttended - targetDecimal * effectiveConducted) / targetDecimal));
      } else {
        // Required classes formula: ceil((T * N - A) / (1 - T))
        requiredToAttend = Math.max(0, Math.ceil((targetDecimal * effectiveConducted - effectiveAttended) / (1 - targetDecimal)));
      }

      // Projections
      const nextIfAttended = Math.round(((effectiveAttended + 1) / (effectiveConducted + 1)) * 1000) / 10;
      const nextIfMissed = Math.round((effectiveAttended / (effectiveConducted + 1)) * 1000) / 10;
      const next2IfAttended = Math.round(((effectiveAttended + 2) / (effectiveConducted + 2)) * 1000) / 10;

      // Status
      let status = 'SAFE';
      let statusLabel = '🛡️ Safe';
      let statusClass = 'pill-accent';

      if (currentPct < targetThreshold) {
        status = 'CRITICAL';
        statusLabel = '🚨 Critical';
        statusClass = 'pill-danger';
      } else if (safeBunks <= 1) {
        status = 'WARNING';
        statusLabel = '⚠️ Warning (On the edge)';
        statusClass = 'pill-accent2';
      }

      return {
        ...s,
        conducted: conducted > 0 ? conducted : 0,
        attendedActual: s.attended,
        currentPct,
        safeBunks,
        requiredToAttend,
        nextIfAttended,
        nextIfMissed,
        next2IfAttended,
        status,
        statusLabel,
        statusClass
      };
    });
  }

  /**
   * Generates the Attendance Calculator HTML view.
   * @param {object} store
   * @param {number} threshold
   * @returns {string} HTML string
   */
  static renderView(store, threshold = 75) {
    const stats = this.calculateSubjectStats(store, threshold);
    const criticalCount = stats.filter(s => s.status === 'CRITICAL').length;
    const warningCount = stats.filter(s => s.status === 'WARNING').length;
    const safeCount = stats.filter(s => s.status === 'SAFE').length;

    return `
      <div class="attendance-calc-container" style="display:flex; flex-direction:column; gap:16px;">
        <!-- Header & Target Threshold Bar -->
        <div class="card" style="padding:16px; background:var(--bg-2); border:1px solid var(--border-soft);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--accent);">Academic Attendance Safety Engine</div>
              <h3 style="font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--text-bright); margin-top:2px;">
                Subject-wise Attendance &amp; Bunk Calculator
              </h3>
              <div class="dim" style="font-size:12px; margin-top:2px;">
                Calculates maximum safe leaves and mandatory classes required to stay above college criteria.
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <label style="font-size:12px; font-weight:700; color:var(--text-bright);">Target Criterion:</label>
              <div class="btn-group" id="attendanceThresholdSelector" style="display:inline-flex; border-radius:8px; overflow:hidden; border:1px solid var(--border);">
                ${[75, 80, 85, 90].map(val => `
                  <button class="btn btn-sm ${threshold === val ? 'btn-accent' : 'btn-ghost'} att-thresh-btn" data-threshold="${val}" style="padding:6px 12px; font-weight:600;">
                    ${val}%
                  </button>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Overall Summary Pills -->
          <div class="grid grid-4" style="gap:10px; margin-top:14px; border-top:1px solid var(--border-soft); padding-top:12px;">
            <div>
              <div class="dim" style="font-size:11px;">Tracked Subjects</div>
              <div class="mono" style="font-size:16px; font-weight:700; color:var(--text-bright);">${stats.length} Subjects</div>
            </div>
            <div>
              <div class="dim" style="font-size:11px;">Safe Subjects</div>
              <div class="mono" style="font-size:16px; font-weight:700; color:var(--accent);">${safeCount} Safe 🛡️</div>
            </div>
            <div>
              <div class="dim" style="font-size:11px;">Warning Subjects</div>
              <div class="mono" style="font-size:16px; font-weight:700; color:var(--accent2);">${warningCount} Warning ⚠️</div>
            </div>
            <div>
              <div class="dim" style="font-size:11px;">Critical Under Target</div>
              <div class="mono" style="font-size:16px; font-weight:700; color:var(--danger);">${criticalCount} Action Required 🚨</div>
            </div>
          </div>
        </div>

        <!-- Subject Cards Grid -->
        <div class="grid grid-2" style="gap:16px; align-items:stretch;">
          ${stats.map(s => `
            <div class="card" style="padding:16px; display:flex; flex-direction:column; gap:12px; background:var(--bg-2); border:1px solid ${s.status==='CRITICAL' ? 'var(--danger)' : s.status==='WARNING' ? 'var(--accent2)' : 'var(--border-soft)'};">
              <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                <div>
                  <span class="pill ${s.statusClass}" style="font-size:10.5px; font-weight:700; margin-bottom:4px;">${s.statusLabel}</span>
                  <div style="font-family:var(--font-display); font-size:16px; font-weight:700; color:var(--text-bright);">${escapeHtml(s.subject)}</div>
                  <div class="dim" style="font-size:11.5px; margin-top:2px;">
                    ${s.faculty ? `👤 ${escapeHtml(s.faculty)}` : ''} ${s.room ? `• 🏛 ${escapeHtml(s.room)}` : ''}
                  </div>
                </div>
                <div style="text-align:right;">
                  <div class="mono" style="font-size:20px; font-weight:800; color:${s.currentPct >= threshold ? 'var(--accent)' : 'var(--danger)'};">
                    ${s.currentPct}%
                  </div>
                  <div class="dim" style="font-size:11px;">Target: ${threshold}%</div>
                </div>
              </div>

              <!-- Progress bar -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                  <span class="dim">Conducted: ${s.conducted} classes</span>
                  <span class="mono" style="font-weight:600; color:var(--text-bright);">${s.attendedActual} Attended / ${s.absent} Absent</span>
                </div>
                <div style="height:8px; background:var(--border-soft); border-radius:4px; overflow:hidden; position:relative;">
                  <div style="width:${Math.min(100, s.currentPct)}%; height:100%; background:${s.currentPct >= threshold ? 'var(--accent)' : 'var(--danger)'}; transition:width 0.3s ease;"></div>
                </div>
              </div>

              <!-- Safe Bunks / Required Action Banner -->
              <div style="padding:10px 12px; border-radius:8px; background:var(--glass); border:1px solid var(--border-soft);">
                ${s.status === 'CRITICAL' ? `
                  <div style="font-size:12.5px; color:var(--danger); font-weight:600;">
                    🚨 <strong>Action Needed:</strong> Must attend next <strong>${s.requiredToAttend} consecutive class${s.requiredToAttend === 1 ? '' : 'es'}</strong> to reach ${threshold}%.
                  </div>
                ` : s.safeBunks > 0 ? `
                  <div style="font-size:12.5px; color:var(--accent); font-weight:600;">
                    🛡️ <strong>Safe to Miss:</strong> You can safely bunk next <strong>${s.safeBunks} class${s.safeBunks === 1 ? '' : 'es'}</strong> while maintaining ≥${threshold}%.
                  </div>
                ` : `
                  <div style="font-size:12.5px; color:var(--accent2); font-weight:600;">
                    ⚠️ <strong>On the Edge:</strong> You have <strong>0 safe bunks</strong>. Missing next class will drop attendance below ${threshold}%.
                  </div>
                `}
              </div>

              <!-- Future Projections Grid -->
              <div class="grid grid-2" style="gap:8px; font-size:11.5px; border-top:1px solid var(--border-soft); padding-top:8px; margin-top:auto;">
                <div style="background:var(--bg-3); padding:6px 8px; border-radius:6px;">
                  <div class="dim" style="font-size:10px;">If you attend next class:</div>
                  <div class="mono" style="font-weight:700; color:var(--accent); margin-top:1px;">
                    Attendance → ${s.nextIfAttended}%
                  </div>
                </div>
                <div style="background:var(--bg-3); padding:6px 8px; border-radius:6px;">
                  <div class="dim" style="font-size:10px;">If you miss next class:</div>
                  <div class="mono" style="font-weight:700; color:var(--danger); margin-top:1px;">
                    Attendance → ${s.nextIfMissed}%
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

if (typeof window !== 'undefined') {
  window.AttendanceCalculator = AttendanceCalculator;
}
