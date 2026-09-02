import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-load .env file
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (e) {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ MISSING CREDENTIALS: You must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function runMigration() {
  console.log("🚀 Starting Section-by-Section Multi-Table Migration...");

  // Fetch all profiles from user_profiles
  const { data: profiles, error: pErr } = await supabase.from('user_profiles').select('*');
  if (pErr) {
    console.error("❌ Failed to read user_profiles:", pErr);
    process.exit(1);
  }

  console.log(`Found ${profiles.length} user profile(s) to migrate into separate tables.`);

  for (const profile of profiles) {
    const userId = profile.id;
    const email = profile.email;
    const store = profile.data || {};

    console.log(`\nMigrating user: ${email} (${userId})...`);

    // 1. user_settings
    try {
      await supabase.from('user_settings').upsert({
        id: userId,
        email: email,
        name: store.settings?.name || store.user?.profile?.name || 'Student',
        theme: store.settings?.theme || 'dark',
        accent: store.settings?.accentColor || store.settings?.accent || 'blue',
        glass_fx: store.settings?.glassFx || 'ultra',
        schedule: store.settings?.schedule || {},
        cycle_history: store.cycleHistory || [],
        active_modules: store.settings?.activeModules || [],
        about_cycle_doc_url: store.settings?.aboutCycleDocUrl || 'https://docs.google.com/document/d/14H0fyrX7d7GDtxSUwecF4guQVvKPEnIGGgtR22IxEwM/edit?usp=sharing',
        onboarding: store.onboarding || {},
        pinned_sections: store.pinnedSections || {},
        expanded_sections: store.expandedSections || {},
        notifications_config: store.notificationsConfig || {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
      console.log('  ✓ user_settings migrated');
    } catch (e) { console.warn('  ⚠️ user_settings note:', e.message); }

    // 2. planner_days
    try {
      if (store.plannerData && typeof store.plannerData === 'object') {
        const entries = Object.entries(store.plannerData).map(([date, p]) => ({
          user_id: userId,
          date,
          tasks: p.tasks || [],
          checklist: p.checklist || [],
          notes: p.notes || '',
          mood: p.mood,
          energy: p.energy,
          water: Number(p.water || 0),
          sleep_time: p.sleepTime || '',
          wake_time: p.wakeTime || '',
          reflection: p.reflection || { wins: '', learned: '', improve: '', gratitude: '' },
          updated_at: new Date().toISOString()
        }));
        if (entries.length > 0) {
          await supabase.from('planner_days').upsert(entries, { onConflict: 'user_id,date' });
          console.log(`  ✓ planner_days (${entries.length} dates) migrated`);
        }
      }
    } catch (e) { console.warn('  ⚠️ planner_days note:', e.message); }

    // 3. habits & habit_logs
    try {
      if (Array.isArray(store.habits) && store.habits.length > 0) {
        const hRows = store.habits.map(h => ({
          id: h.id,
          user_id: userId,
          name: h.name,
          category: h.category || 'growth',
          frequency: h.frequency || 'daily',
          target_days: Number(h.targetDays || 7),
          archived: Boolean(h.archived),
          reminder_time: h.reminderTime || null,
          stack_anchor: h.stackAnchor || null,
          notes: h.notes || null,
          created_at: h.createdAt || new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString()
        }));
        await supabase.from('habits').upsert(hRows, { onConflict: 'id' });
        console.log(`  ✓ habits (${hRows.length} habits) migrated`);
      }
      if (store.habitLogs && typeof store.habitLogs === 'object') {
        const logRows = [];
        Object.entries(store.habitLogs).forEach(([date, dayMap]) => {
          if (dayMap && typeof dayMap === 'object') {
            Object.entries(dayMap).forEach(([habitId, status]) => {
              logRows.push({
                user_id: userId,
                date,
                habit_id: habitId,
                status: String(status),
                created_at: new Date().toISOString()
              });
            });
          }
        });
        if (logRows.length > 0) {
          await supabase.from('habit_logs').upsert(logRows, { onConflict: 'user_id,date,habit_id' });
          console.log(`  ✓ habit_logs (${logRows.length} logs) migrated`);
        }
      }
    } catch (e) { console.warn('  ⚠️ habits note:', e.message); }

    // 4. pomodoro_sessions
    try {
      if (Array.isArray(store.pomodoroHistory) && store.pomodoroHistory.length > 0) {
        const pomoRows = store.pomodoroHistory.map(p => ({
          id: p.id || ('pomo_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          type: p.type || 'focus',
          minutes: Number(p.minutes || 25),
          task_id: p.taskId || null,
          timestamp: p.timestamp || new Date().toISOString(),
          created_at: new Date().toISOString()
        }));
        await supabase.from('pomodoro_sessions').upsert(pomoRows, { onConflict: 'id' });
        console.log(`  ✓ pomodoro_sessions (${pomoRows.length} sessions) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ pomodoro_sessions note:', e.message); }

    // 5. goals
    try {
      if (Array.isArray(store.goals) && store.goals.length > 0) {
        const goalRows = store.goals.map(g => ({
          id: g.id || ('goal_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          title: g.title,
          timeframe: g.timeframe || 'monthly',
          deadline: g.deadline || null,
          description: g.description || '',
          category: g.category || 'life',
          target: g.target || null,
          unit: g.unit || null,
          done: Boolean(g.done),
          subtasks: g.subtasks || [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        await supabase.from('goals').upsert(goalRows, { onConflict: 'id' });
        console.log(`  ✓ goals (${goalRows.length} goals) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ goals note:', e.message); }

    // 6. projects
    try {
      if (Array.isArray(store.projects) && store.projects.length > 0) {
        const projRows = store.projects.map(p => ({
          id: p.id || ('proj_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          title: p.title,
          tech: p.tech || '',
          desc: p.desc || '',
          status: p.status || 'Active',
          github_url: p.githubUrl || null,
          live_url: p.liveUrl || null,
          milestones: p.milestones || [],
          logs: p.logs || [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        await supabase.from('projects').upsert(projRows, { onConflict: 'id' });
        console.log(`  ✓ projects (${projRows.length} projects) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ projects note:', e.message); }

    // 7. study_sessions
    try {
      if (Array.isArray(store.studySessions) && store.studySessions.length > 0) {
        const studyRows = store.studySessions.map(s => ({
          id: s.id || ('study_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          subject: s.subject,
          topic: s.topic || '',
          date: s.date || new Date().toISOString().slice(0, 10),
          hours: Number(s.hours || 0),
          problems: Number(s.problems || 0),
          notes: s.notes || '',
          created_at: new Date().toISOString()
        }));
        await supabase.from('study_sessions').upsert(studyRows, { onConflict: 'id' });
        console.log(`  ✓ study_sessions (${studyRows.length} sessions) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ study_sessions note:', e.message); }

    // 8. contests
    try {
      if (store.contests && Array.isArray(store.contests.entries) && store.contests.entries.length > 0) {
        const cRows = store.contests.entries.map(c => ({
          id: c.id || ('contest_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          name: c.name,
          platform: c.platform || 'Codeforces',
          date: c.date,
          start_time: c.startTime || null,
          duration: c.duration || null,
          contest_url: c.contestUrl || null,
          registered: Boolean(c.registered),
          reminder_set: Boolean(c.reminderSet),
          target_rank: c.targetRank || null,
          actual_rank: c.actualRank || null,
          problems_solved: Number(c.problemsSolved || 0),
          rating_change: c.ratingChange || null,
          notes: c.notes || null,
          status: c.status || 'upcoming',
          created_at: new Date().toISOString()
        }));
        await supabase.from('contests').upsert(cRows, { onConflict: 'id' });
        console.log(`  ✓ contests (${cRows.length} entries) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ contests note:', e.message); }

    // 9. exams
    try {
      if (store.exams && Array.isArray(store.exams.list) && store.exams.list.length > 0) {
        const examRows = store.exams.list.map(e => ({
          id: e.id || ('exam_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          name: e.name,
          type: e.type || 'Internal / CAT',
          date: e.date || null,
          start_time: e.startTime || null,
          end_time: e.endTime || null,
          semester: e.semester || null,
          notes: e.notes || '',
          subjects: e.subjects || [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        await supabase.from('exams').upsert(examRows, { onConflict: 'id' });
        console.log(`  ✓ exams (${examRows.length} exams) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ exams note:', e.message); }

    // 10. college_timetable
    try {
      if (store.college) {
        await supabase.from('college_timetable').upsert({
          user_id: userId,
          schedules: store.college.schedules || {},
          updates: store.college.updates || [],
          default_classes: store.college.defaultClasses || [],
          semester_subjects: store.college.semesterSubjects || [],
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        console.log('  ✓ college_timetable migrated');
      }
    } catch (e) { console.warn('  ⚠️ college_timetable note:', e.message); }

    // 11. fitness_vitals
    try {
      await supabase.from('fitness_vitals').upsert({
        user_id: userId,
        trackers: store.fitnessTrackers || [],
        goals: store.fitnessGoals || [],
        vitals_logs: store.fitnessLogs || {},
        health_logs: store.healthLogs || {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      console.log('  ✓ fitness_vitals migrated');
    } catch (e) { console.warn('  ⚠️ fitness_vitals note:', e.message); }

    // 12. finance_transactions
    try {
      if (Array.isArray(store.finance) && store.finance.length > 0) {
        const finRows = store.finance.map(f => ({
          id: f.id || ('fin_' + Math.random().toString(36).slice(2, 9)),
          user_id: userId,
          type: f.type || 'expense',
          amount: Number(f.amount || 0),
          category: f.category || 'General',
          date: f.date || new Date().toISOString().slice(0, 10),
          description: f.description || '',
          method: f.method || 'Card',
          created_at: new Date().toISOString()
        }));
        await supabase.from('finance_transactions').upsert(finRows, { onConflict: 'id' });
        console.log(`  ✓ finance_transactions (${finRows.length} transactions) migrated`);
      }
    } catch (e) { console.warn('  ⚠️ finance_transactions note:', e.message); }

    // 13. journal_and_notes
    try {
      await supabase.from('journal_and_notes').upsert({
        user_id: userId,
        journal: store.journal || [],
        notes: store.notes || [],
        books: store.books || [],
        mistakes: store.mistakes || [],
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      console.log('  ✓ journal_and_notes migrated');
    } catch (e) { console.warn('  ⚠️ journal_and_notes note:', e.message); }
  }

  console.log("\n✅ Multi-Table Section-by-Section Migration Complete! Original 'user_profiles' table remains intact as backup.");
}

runMigration().catch(console.error);
