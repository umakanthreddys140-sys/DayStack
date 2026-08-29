/**
 * DAYSTACK Selective CSV Export Center
 * Exports individual datasets cleanly to standard CSV files.
 */

function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export class CsvExporter {
  /**
   * Exports Finance transactions to CSV.
   * @param {object} store
   */
  static exportFinance(store) {
    const list = (store && store.finance) || [];
    if (!list.length) return false;

    let csv = 'Date,Type,Category,Amount,Note\n';
    list.forEach(f => {
      csv += [
        escapeCsvField(f.date),
        escapeCsvField(f.type),
        escapeCsvField(f.category),
        escapeCsvField(f.amount),
        escapeCsvField(f.note || '')
      ].join(',') + '\n';
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `daystack_finance_${dateStr}.csv`);
    return true;
  }

  /**
   * Exports Attendance & College class schedules to CSV.
   * @param {object} store
   */
  static exportAttendance(store) {
    const schedules = (store && store.college && store.college.schedules) || {};
    const dates = Object.keys(schedules);
    if (!dates.length) return false;

    let csv = 'Date,Subject,Faculty,Room,ClassType,StartTime,EndTime,AttendanceStatus,Agenda\n';
    dates.forEach(d => {
      const sched = schedules[d];
      (sched.classes || []).forEach(c => {
        csv += [
          escapeCsvField(d),
          escapeCsvField(c.subject),
          escapeCsvField(c.faculty || ''),
          escapeCsvField(c.room || ''),
          escapeCsvField(c.classType || 'Lecture'),
          escapeCsvField(c.startTime || ''),
          escapeCsvField(c.endTime || ''),
          escapeCsvField(c.attendance || 'Upcoming'),
          escapeCsvField(c.agenda || '')
        ].join(',') + '\n';
      });
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `daystack_attendance_${dateStr}.csv`);
    return true;
  }

  /**
   * Exports Habits logs to CSV.
   * @param {object} store
   */
  static exportHabits(store) {
    const logs = (store && store.habitLogs) || {};
    const habits = (store && store.habits) || [];
    const dates = Object.keys(logs);
    if (!dates.length) return false;

    let csv = 'Date,HabitName,Category,Status\n';
    dates.forEach(date => {
      const dayLog = logs[date] || {};
      Object.entries(dayLog).forEach(([habitId, status]) => {
        const habit = habits.find(h => h.id === habitId);
        const name = habit ? habit.name : habitId;
        const cat = habit ? habit.category : 'general';
        csv += [
          escapeCsvField(date),
          escapeCsvField(name),
          escapeCsvField(cat),
          escapeCsvField(status)
        ].join(',') + '\n';
      });
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `daystack_habits_${dateStr}.csv`);
    return true;
  }

  /**
   * Exports Dojo & DSA Coding tasks to CSV.
   * @param {object} store
   */
  static exportDojo(store) {
    const tasks = (store && store.dojo && store.dojo.codingTasks) || [];
    const belts = (store && store.dojo && store.dojo.belts) || [];
    if (!tasks.length && !belts.length) return false;

    let csv = 'RecordType,Title,Platform,Language,Topic,Difficulty,Status,TargetDate,Notes\n';
    tasks.forEach(t => {
      csv += [
        escapeCsvField('Coding Task'),
        escapeCsvField(t.title),
        escapeCsvField(t.platform || 'LeetCode'),
        escapeCsvField(t.language || 'Python'),
        escapeCsvField(t.topic || 'Algorithms'),
        escapeCsvField(t.difficulty || 'Medium'),
        escapeCsvField(t.status || 'In Progress'),
        escapeCsvField(t.targetDate || ''),
        escapeCsvField(t.notes || '')
      ].join(',') + '\n';
    });

    belts.forEach(b => {
      csv += [
        escapeCsvField('Belt Level'),
        escapeCsvField(b.name),
        escapeCsvField('Dojo'),
        escapeCsvField('Multi'),
        escapeCsvField(b.topics || ''),
        escapeCsvField(`Req: ${b.problemsRequired}`),
        escapeCsvField(b.completed ? 'Completed' : 'In Progress'),
        escapeCsvField(b.targetDate || ''),
        escapeCsvField(b.badge || '')
      ].join(',') + '\n';
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `daystack_dojo_dsa_${dateStr}.csv`);
    return true;
  }

  /**
   * Exports Daily Planner Tasks to CSV.
   * @param {object} store
   */
  static exportTasks(store) {
    const plans = (store && store.plannerData) || {};
    const dates = Object.keys(plans);
    if (!dates.length) return false;

    let csv = 'Date,Time,TaskTitle,Priority,Completed,CompletedAt,Notes\n';
    dates.forEach(d => {
      const plan = plans[d];
      (plan.tasks || []).forEach(t => {
        csv += [
          escapeCsvField(d),
          escapeCsvField(t.time || 'Flexible'),
          escapeCsvField(t.text),
          escapeCsvField(t.priority || 'medium'),
          escapeCsvField(t.done ? 'Yes' : 'No'),
          escapeCsvField(t.completedAt || ''),
          escapeCsvField(t.notes || '')
        ].join(',') + '\n';
      });
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `daystack_planner_tasks_${dateStr}.csv`);
    return true;
  }

  /**
   * Exports Exam data and subjects to CSV.
   * @param {object} store
   */
  static exportExams(store) {
    const subjects = (store && store.exams && store.exams.subjects) || [];
    if (!subjects.length) return false;

    let csv = 'Subject,Category,Date,Time,TargetMarks,AchievedMarks,PrepPercentage,Status,ImportantTopics,Notes\n';
    subjects.forEach(s => {
      csv += [
        escapeCsvField(s.subject),
        escapeCsvField(s.category),
        escapeCsvField(s.date || ''),
        escapeCsvField(s.time || ''),
        escapeCsvField(s.targetMarks || 100),
        escapeCsvField(s.achievedMarks != null ? s.achievedMarks : ''),
        escapeCsvField(s.prepPct || 0),
        escapeCsvField(s.status || 'In Progress'),
        escapeCsvField(s.importantTopics || ''),
        escapeCsvField(s.notes || '')
      ].join(',') + '\n';
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `daystack_exams_${dateStr}.csv`);
    return true;
  }
}

if (typeof window !== 'undefined') {
  window.CsvExporter = CsvExporter;
}
