/**
 * DAYSTACK Academic SGPA Calculator & CGPA Predictor
 * Computes exact weighted grade points, semester performance, and target goals.
 */

import { escapeHtml } from '../../utils/sanitize.js';

export const DEFAULT_GRADING_SCALES = {
  standard_10: {
    name: '10-Point Scale (Standard)',
    grades: [
      { label: 'O (Outstanding)', point: 10 },
      { label: 'A+ (Excellent)', point: 9 },
      { label: 'A (Very Good)', point: 8 },
      { label: 'B+ (Good)', point: 7 },
      { label: 'B (Above Average)', point: 6 },
      { label: 'C (Average)', point: 5 },
      { label: 'P (Pass)', point: 4 },
      { label: 'F (Fail)', point: 0 }
    ]
  }
};

export class GpaCalculator {
  /**
   * Calculates SGPA from course subjects.
   * @param {Array<object>} courses Array of { subject, credits, gradePoint }
   * @returns {object} { sgpa, totalCredits, totalPoints }
   */
  static calculateSgpa(courses) {
    if (!Array.isArray(courses) || !courses.length) {
      return { sgpa: 0.0, totalCredits: 0, totalPoints: 0 };
    }
    let totalCredits = 0;
    let totalPoints = 0;

    courses.forEach(c => {
      const cr = Number(c.credits) || 0;
      const gp = Number(c.gradePoint) || 0;
      if (cr > 0) {
        totalCredits += cr;
        totalPoints += cr * gp;
      }
    });

    const sgpa = totalCredits > 0 ? Math.round((totalPoints / totalCredits) * 100) / 100 : 0.0;
    return {
      sgpa,
      totalCredits,
      totalPoints: Math.round(totalPoints * 100) / 100
    };
  }

  /**
   * Calculates overall CGPA across completed semesters and predicts required future SGPA.
   * @param {Array<object>} semesters Array of { semester, credits, sgpa, completed }
   * @param {number} targetCgpa Target CGPA
   * @returns {object}
   */
  static calculateCgpaPrediction(semesters, targetCgpa = 8.5) {
    if (!Array.isArray(semesters) || !semesters.length) {
      return {
        completedCredits: 0,
        completedPoints: 0,
        currentCgpa: 0.0,
        totalCredits: 0,
        remainingCredits: 0,
        requiredFutureSgpa: 0.0,
        isPossible: true
      };
    }

    let completedCredits = 0;
    let completedPoints = 0;
    let totalCredits = 0;
    let remainingCredits = 0;

    semesters.forEach(s => {
      const cr = Number(s.credits) || 0;
      const sg = Number(s.sgpa) || 0;
      totalCredits += cr;
      if (s.completed) {
        completedCredits += cr;
        completedPoints += cr * sg;
      } else {
        remainingCredits += cr;
      }
    });

    const currentCgpa = completedCredits > 0
      ? Math.round((completedPoints / completedCredits) * 100) / 100
      : 0.0;

    let requiredFutureSgpa = 0.0;
    let isPossible = true;

    if (remainingCredits > 0 && targetCgpa > 0) {
      const requiredTotalPoints = targetCgpa * totalCredits;
      const remainingPointsNeeded = requiredTotalPoints - completedPoints;
      requiredFutureSgpa = Math.round((remainingPointsNeeded / remainingCredits) * 100) / 100;
      isPossible = requiredFutureSgpa <= 10.0;
    }

    return {
      completedCredits,
      completedPoints: Math.round(completedPoints * 100) / 100,
      currentCgpa,
      totalCredits,
      remainingCredits,
      requiredFutureSgpa,
      isPossible
    };
  }

  /**
   * Returns default sample SGPA courses.
   */
  static getDefaultCourses() {
    return [
      { id: 'c1', subject: 'Database Management Systems', credits: 4, gradePoint: 9, grade: 'A+' },
      { id: 'c2', subject: 'Operating Systems', credits: 4, gradePoint: 8, grade: 'A' },
      { id: 'c3', subject: 'Computer Networks', credits: 3, gradePoint: 9, grade: 'A+' },
      { id: 'c4', subject: 'Discrete Mathematics', credits: 4, gradePoint: 8, grade: 'A' },
      { id: 'c5', subject: 'Web Technology Lab', credits: 2, gradePoint: 10, grade: 'O' },
      { id: 'c6', subject: 'Soft Skills & Aptitude', credits: 1, gradePoint: 9, grade: 'A+' }
    ];
  }

  /**
   * Returns default sample multi-semester CGPA data.
   */
  static getDefaultSemesters() {
    return [
      { id: 'sem_1', name: 'Semester 1', credits: 21, sgpa: 8.42, completed: true },
      { id: 'sem_2', name: 'Semester 2', credits: 22, sgpa: 8.65, completed: true },
      { id: 'sem_3', name: 'Semester 3', credits: 24, sgpa: 8.80, completed: true },
      { id: 'sem_4', name: 'Semester 4', credits: 23, sgpa: 8.55, completed: true },
      { id: 'sem_5', name: 'Semester 5 (Current)', credits: 22, sgpa: 8.90, completed: false },
      { id: 'sem_6', name: 'Semester 6', credits: 20, sgpa: 0.0, completed: false },
      { id: 'sem_7', name: 'Semester 7', credits: 18, sgpa: 0.0, completed: false },
      { id: 'sem_8', name: 'Semester 8', credits: 12, sgpa: 0.0, completed: false }
    ];
  }

  /**
   * Renders the SGPA Calculator view.
   * @param {Array<object>} courses
   * @returns {string} HTML string
   */
  static renderSgpaView(courses = []) {
    const list = courses.length ? courses : this.getDefaultCourses();
    const { sgpa, totalCredits, totalPoints } = this.calculateSgpa(list);

    return `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="card" style="padding:16px; background:var(--bg-2); border:1px solid var(--border-soft);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--accent);">Semester Performance Calculator</div>
              <h3 style="font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--text-bright); margin-top:2px;">
                Semester Grade Point Average (SGPA)
              </h3>
              <div class="dim" style="font-size:12px;">
                Weighted calculation: Σ(Credits × Grade Point) / Σ(Credits)
              </div>
            </div>
            <div style="text-align:right;">
              <div class="mono" style="font-size:28px; font-weight:800; color:var(--accent);">
                ${sgpa.toFixed(2)}
              </div>
              <div class="dim" style="font-size:11.5px;">Computed SGPA / 10.00</div>
            </div>
          </div>

          <div class="grid grid-3" style="gap:10px; margin-top:14px; border-top:1px solid var(--border-soft); padding-top:12px;">
            <div>
              <div class="dim" style="font-size:11px;">Total Enrolled Credits</div>
              <div class="mono" style="font-size:16px; font-weight:700; color:var(--text-bright);">${totalCredits} Credits</div>
            </div>
            <div>
              <div class="dim" style="font-size:11px;">Total Credit Points</div>
              <div class="mono" style="font-size:16px; font-weight:700; color:var(--accent2);">${totalPoints} Pts</div>
            </div>
            <div style="text-align:right;">
              <button class="btn btn-sm btn-accent" id="addSgpaCourseBtn">+ Add Subject Row</button>
            </div>
          </div>
        </div>

        <div class="card" style="padding:12px; background:var(--bg-2);">
          <div class="table-responsive">
            <table class="exam-table">
              <thead>
                <tr>
                  <th>Subject / Course Title</th>
                  <th style="width:100px;">Credits</th>
                  <th style="width:140px;">Grade</th>
                  <th style="width:120px;">Grade Point</th>
                  <th style="width:110px;">Credit Pts</th>
                  <th style="text-align:right; width:60px;"></th>
                </tr>
              </thead>
              <tbody id="sgpaCourseTableBody">
                ${list.map(c => {
                  const pts = (Number(c.credits) || 0) * (Number(c.gradePoint) || 0);
                  return `
                    <tr data-sgpa-row="${c.id}">
                      <td>
                        <input type="text" class="sgpa-in-sub" data-cid="${c.id}" value="${escapeHtml(c.subject)}" placeholder="Enter subject name" style="width:100%; padding:6px 8px; font-size:13px;" />
                      </td>
                      <td>
                        <input type="number" min="0" max="10" step="0.5" class="sgpa-in-cred" data-cid="${c.id}" value="${c.credits}" style="width:100%; padding:6px 8px; font-size:13px;" />
                      </td>
                      <td>
                        <select class="sgpa-in-grade" data-cid="${c.id}" style="width:100%; padding:6px 8px; font-size:12.5px;">
                          <option value="10" ${c.gradePoint === 10 ? 'selected' : ''}>O (10)</option>
                          <option value="9" ${c.gradePoint === 9 ? 'selected' : ''}>A+ (9)</option>
                          <option value="8" ${c.gradePoint === 8 ? 'selected' : ''}>A (8)</option>
                          <option value="7" ${c.gradePoint === 7 ? 'selected' : ''}>B+ (7)</option>
                          <option value="6" ${c.gradePoint === 6 ? 'selected' : ''}>B (6)</option>
                          <option value="5" ${c.gradePoint === 5 ? 'selected' : ''}>C (5)</option>
                          <option value="4" ${c.gradePoint === 4 ? 'selected' : ''}>P (4)</option>
                          <option value="0" ${c.gradePoint === 0 ? 'selected' : ''}>F (0)</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" min="0" max="10" step="0.1" class="sgpa-in-point" data-cid="${c.id}" value="${c.gradePoint}" style="width:100%; padding:6px 8px; font-size:13px;" />
                      </td>
                      <td class="mono" style="font-weight:700; color:var(--accent);">
                        ${pts.toFixed(1)}
                      </td>
                      <td style="text-align:right;">
                        <button class="btn-icon btn-icon-danger sgpa-del-btn" data-del-cid="${c.id}" title="Remove course">🗑️</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders the CGPA Predictor view.
   * @param {Array<object>} semesters
   * @param {number} targetCgpa
   * @returns {string} HTML string
   */
  static renderCgpaView(semesters = [], targetCgpa = 8.5) {
    const list = semesters.length ? semesters : this.getDefaultSemesters();
    const prediction = this.calculateCgpaPrediction(list, targetCgpa);

    return `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="card" style="padding:16px; background:var(--bg-2); border:1px solid var(--border-soft);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--accent2);">Multi-Semester Graduation Analytics</div>
              <h3 style="font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--text-bright); margin-top:2px;">
                Cumulative CGPA &amp; What-If Predictor
              </h3>
              <div class="dim" style="font-size:12px;">
                Track completed semesters and estimate future SGPA required to reach your target CGPA.
              </div>
            </div>
            <div style="display:flex; gap:20px; align-items:center;">
              <div style="text-align:right;">
                <div class="mono" style="font-size:26px; font-weight:800; color:var(--accent);">
                  ${prediction.currentCgpa.toFixed(2)}
                </div>
                <div class="dim" style="font-size:11px;">Current CGPA (${prediction.completedCredits} credits)</div>
              </div>
              <div style="border-left:1px solid var(--border-soft); padding-left:16px;">
                <label style="font-size:11px; font-weight:700; color:var(--accent2); display:block;">Target CGPA Goal</label>
                <input type="number" id="cgpaTargetInput" value="${targetCgpa}" min="1" max="10" step="0.05" style="font-size:16px; font-weight:700; width:90px; padding:4px 8px; font-family:var(--font-mono); margin-top:2px;" />
              </div>
            </div>
          </div>

          <!-- Prediction result banner -->
          <div style="margin-top:14px; padding:12px 14px; border-radius:8px; background:var(--glass); border:1px solid var(--border-soft);">
            ${prediction.remainingCredits === 0 ? `
              <div style="font-size:13px; font-weight:600; color:var(--accent);">
                🎉 All semesters completed! Final Cumulative CGPA is <strong>${prediction.currentCgpa.toFixed(2)}</strong>.
              </div>
            ` : prediction.isPossible ? `
              <div style="font-size:13px; font-weight:600; color:var(--accent2);">
                🎯 To achieve <strong>${targetCgpa.toFixed(2)} CGPA</strong>, you need an average SGPA of <strong>${prediction.requiredFutureSgpa.toFixed(2)}</strong> across your remaining ${prediction.remainingCredits} credits.
              </div>
            ` : `
              <div style="font-size:13px; font-weight:600; color:var(--danger);">
                ⚠️ Target ${targetCgpa.toFixed(2)} mathematically exceeds 10.00 maximum ceiling (requires ${prediction.requiredFutureSgpa.toFixed(2)} SGPA). Consider adjusting target.
              </div>
            `}
          </div>
        </div>

        <!-- Semester Table -->
        <div class="card" style="padding:12px; background:var(--bg-2);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4 style="font-size:14px; font-weight:700; color:var(--text-bright);">Semester-wise Record</h4>
            <button class="btn btn-sm btn-ghost" id="addCgpaSemesterBtn">+ Add Semester</button>
          </div>
          <div class="table-responsive">
            <table class="exam-table">
              <thead>
                <tr>
                  <th>Semester</th>
                  <th style="width:120px;">Credits</th>
                  <th style="width:120px;">SGPA</th>
                  <th style="width:140px;">Status</th>
                  <th style="width:120px;">Credit Pts</th>
                  <th style="text-align:right; width:60px;"></th>
                </tr>
              </thead>
              <tbody id="cgpaSemesterTableBody">
                ${list.map(s => {
                  const pts = (Number(s.credits) || 0) * (Number(s.sgpa) || 0);
                  return `
                    <tr data-cgpa-row="${s.id}">
                      <td>
                        <input type="text" class="cgpa-in-name" data-sid="${s.id}" value="${escapeHtml(s.name)}" style="width:100%; padding:6px 8px; font-size:13px;" />
                      </td>
                      <td>
                        <input type="number" min="1" max="40" step="0.5" class="cgpa-in-cred" data-sid="${s.id}" value="${s.credits}" style="width:100%; padding:6px 8px; font-size:13px;" />
                      </td>
                      <td>
                        <input type="number" min="0" max="10" step="0.01" class="cgpa-in-sgpa" data-sid="${s.id}" value="${s.sgpa || 0}" style="width:100%; padding:6px 8px; font-size:13px;" />
                      </td>
                      <td>
                        <select class="cgpa-in-done" data-sid="${s.id}" style="width:100%; padding:6px 8px; font-size:12.5px;">
                          <option value="true" ${s.completed ? 'selected' : ''}>✓ Completed</option>
                          <option value="false" ${!s.completed ? 'selected' : ''}>⏳ Projected</option>
                        </select>
                      </td>
                      <td class="mono" style="font-weight:700; color:var(--accent);">
                        ${s.completed ? pts.toFixed(1) : '<span class="dim">—</span>'}
                      </td>
                      <td style="text-align:right;">
                        <button class="btn-icon btn-icon-danger cgpa-del-btn" data-del-sid="${s.id}" title="Remove semester">🗑️</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
}

if (typeof window !== 'undefined') {
  window.GpaCalculator = GpaCalculator;
}
