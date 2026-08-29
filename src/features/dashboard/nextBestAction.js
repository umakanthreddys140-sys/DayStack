/**
 * DAYSTACK Dashboard Next Best Action Engine
 * Dynamically computes prioritized smart recommendations based on real-time daily metrics.
 */

import { escapeHtml } from '../../utils/sanitize.js';
import { AttendanceCalculator } from '../college/attendanceCalc.js';

export class NextBestActionEngine {
  /**
   * Evaluates the full workspace store and returns the single highest priority action.
   * @param {object} store DAYSTACK Store
   * @param {string} today YYYY-MM-DD
   * @returns {object} { icon, title, subtitle, badge, actionSection, actionText, actionFn }
   */
  static getNextAction(store, today = new Date().toISOString().slice(0, 10)) {
    if (!store) {
      return {
        icon: '🎯',
        title: 'Plan Your Day',
        subtitle: 'Review your tasks and habit targets for today.',
        badge: 'Priority',
        actionSection: 'planner',
        actionText: 'Open Daily Planner'
      };
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 1. Check for upcoming college class today
    const dayCollege = (store.college?.schedules && store.college.schedules[today]) || { classes: store.college?.defaultClasses || [] };
    const classes = dayCollege.classes || [];
    const upcomingClass = classes.find(c => (c.startTime || '') >= currentTimeStr && c.attendance !== 'Cancelled');

    if (upcomingClass) {
      return {
        icon: '🏛️',
        title: `Next Class: ${upcomingClass.subject}`,
        subtitle: `Starts at ${upcomingClass.startTime} in ${upcomingClass.room || 'Room TBA'} with ${upcomingClass.faculty || 'Faculty'}.`,
        badge: 'College Timetable',
        badgeClass: 'pill-accent',
        actionSection: 'college',
        actionText: 'View Class Agenda'
      };
    }

    // 2. Check for Attendance Safety Critical/Warning Alert
    const attendanceStats = AttendanceCalculator.calculateSubjectStats(store, 75);
    const criticalSubject = attendanceStats.find(s => s.status === 'CRITICAL');
    if (criticalSubject) {
      return {
        icon: '🚨',
        title: `Attendance Alert: ${criticalSubject.subject} (${criticalSubject.currentPct}%)`,
        subtitle: `Currently below 75% target. Must attend next ${criticalSubject.requiredToAttend} consecutive classes.`,
        badge: 'Critical Attendance',
        badgeClass: 'pill-danger',
        actionSection: 'college',
        actionText: 'Bunk Calculator'
      };
    }

    // 3. Check for Unfinished High-Priority Tasks in Daily Planner
    const plan = store.plannerData && store.plannerData[today];
    const highPrioTasks = (plan && plan.tasks) ? plan.tasks.filter(t => !t.done && t.priority === 'high') : [];
    if (highPrioTasks.length > 0) {
      return {
        icon: '🔥',
        title: `${highPrioTasks.length} High-Priority Task${highPrioTasks.length > 1 ? 's' : ''} Remaining Today`,
        subtitle: `Next MIT: "${highPrioTasks[0].text}". Check it off in your planner.`,
        badge: 'Daily MIT',
        badgeClass: 'pill-danger',
        actionSection: 'planner',
        actionText: 'Open Daily Planner'
      };
    }

    // 4. Check for Pending DSA / Dojo Problem
    const dojoTasks = (store.dojo && store.dojo.codingTasks) || [];
    const pendingDojo = dojoTasks.filter(t => t.status === 'In Progress');
    if (pendingDojo.length > 0) {
      return {
        icon: '⚔️',
        title: `Active DSA Drill: ${pendingDojo[0].title}`,
        subtitle: `Platform: ${pendingDojo[0].platform || 'LeetCode'} • Topic: ${pendingDojo[0].topic || 'Algorithms'}.`,
        badge: 'Dojo Drill',
        badgeClass: 'pill-accent2',
        actionSection: 'dojo',
        actionText: 'Solve on Dojo'
      };
    }

    // 5. Check for Habit Completion Streak Risk
    const habitLogs = (store.habitLogs && store.habitLogs[today]) || {};
    const totalHabits = (store.habits || []).length;
    const doneHabits = (store.habits || []).filter(h => habitLogs[h.id] === 'done').length;
    const pendingHabits = totalHabits - doneHabits;

    if (pendingHabits > 0 && currentHour >= 14) {
      return {
        icon: '⚡',
        title: `${pendingHabits} Habit${pendingHabits > 1 ? 's' : ''} Left to Protect Daily Streak`,
        subtitle: `${doneHabits}/${totalHabits} completed so far. Keep up your discipline momentum.`,
        badge: 'Habit Streak',
        badgeClass: 'pill-accent',
        actionSection: 'habits',
        actionText: 'Check Habits'
      };
    }

    // 6. Deep Work Focus Session
    return {
      icon: '⏱️',
      title: 'Ready for a Deep Focus Sprint',
      subtitle: 'All daily essentials on track. Start a 25-minute Pomodoro focus block.',
      badge: 'Focus Engine',
      badgeClass: 'pill-accent3',
      actionSection: 'pomodoro',
      actionText: 'Start Pomodoro'
    };
  }

  /**
   * Renders the Next Best Action banner HTML.
   * @param {object} store
   * @returns {string} HTML string
   */
  static renderCard(store) {
    const action = this.getNextAction(store);

    return `
      <div class="card next-best-action-card" style="padding:14px 18px; margin-bottom:16px; background:linear-gradient(135deg, rgba(45,142,255,0.08) 0%, rgba(255,180,84,0.05) 100%), var(--bg-2); border:1px solid var(--border-soft); border-left:4px solid var(--accent); border-radius:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px; min-width:240px; flex:1;">
          <div style="font-size:24px; display:flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:10px; background:var(--glass); border:1px solid var(--border-soft); flex-shrink:0;">
            ${action.icon}
          </div>
          <div style="min-width:0; flex:1;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--accent);">⚡ NEXT BEST ACTION</span>
              <span class="pill ${action.badgeClass || 'pill-dim'}" style="font-size:9.5px; font-weight:700;">${action.badge}</span>
            </div>
            <div style="font-family:var(--font-display); font-size:15px; font-weight:700; color:var(--text-bright); margin-top:2px;">
              ${escapeHtml(action.title)}
            </div>
            <div class="dim" style="font-size:12px; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${escapeHtml(action.subtitle)}
            </div>
          </div>
        </div>
        <button class="btn btn-accent nba-action-btn" data-nba-target="${action.actionSection}" style="font-size:12.5px; padding:8px 16px; flex-shrink:0;">
          ${escapeHtml(action.actionText)} →
        </button>
      </div>
    `;
  }
}

if (typeof window !== 'undefined') {
  window.NextBestActionEngine = NextBestActionEngine;
}
