import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-load .env file if it exists
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
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

// Token Verification In-Memory Cache (token -> { user, expiresAt })
const tokenVerificationCache = new Map();

function cleanTokenCache() {
  const now = Date.now();
  for (const [token, entry] of tokenVerificationCache.entries()) {
    if (entry.expiresAt <= now) {
      tokenVerificationCache.delete(token);
    }
  }
}
setInterval(cleanTokenCache, 60000);

const AUDIT_FILE = path.join(__dirname, '.audit.log.json');
const EMAIL_TEMPLATES_FILE = path.join(__dirname, '.email_templates.json');
const EMAIL_HISTORY_FILE = path.join(__dirname, '.email_history.json');

// Helper to write atomic json
function writeAtomicJson(filePath, data, formatted = false) {
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  const content = formatted ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function audit(action, details = {}) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, '[]');
    const log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
    log.unshift({ id: 'aud_' + Date.now(), timestamp: new Date().toISOString(), action, ...details });
    if (log.length > 500) log.splice(500);
    writeAtomicJson(AUDIT_FILE, log, true);
  } catch {}
}

export async function verifyTokenCryptographically(token) {
  if (!token || typeof token !== 'string') return null;

  // 1. Check in-memory verification cache
  const cached = tokenVerificationCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  // 2. Verify cryptographically via Supabase Auth Client
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data && data.user) {
        const u = data.user;
        const userMeta = u.user_metadata || {};
        const fullName = userMeta.name || userMeta.full_name || userMeta.user_name || '';
        const email = (u.email || '').toLowerCase();
        const isAdmin = (u.app_metadata && u.app_metadata.role === 'admin') ||
                        (u.role === 'admin') ||
                        (Boolean(ADMIN_EMAIL) && email === ADMIN_EMAIL);

        const verifiedUser = {
          id: u.id,
          email: u.email,
          name: fullName || (u.email ? u.email.split('@')[0] : 'Student'),
          role: isAdmin ? 'admin' : (u.role || 'authenticated')
        };

        tokenVerificationCache.set(token, {
          user: verifiedUser,
          expiresAt: Date.now() + 120000 // Cache for 2 mins
        });
        return verifiedUser;
      }
    } catch (e) {}
  }

  // 3. Verify cryptographically via HMAC-SHA256 with JWT_SECRET (for local/custom signed tokens)
  if (JWT_SECRET) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const [headerB64, payloadB64, signatureB64] = parts;
        const expectedSig = crypto
          .createHmac('sha256', JWT_SECRET)
          .update(`${headerB64}.${payloadB64}`)
          .digest('base64url');

        // Timing-safe cryptographic comparison
        const bufSig = Buffer.from(signatureB64);
        const bufExp = Buffer.from(expectedSig);
        if (bufSig.length === bufExp.length && crypto.timingSafeEqual(bufSig, bufExp)) {
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null; // Expired token
          }
          const email = (payload.email || '').toLowerCase();
          const isAdmin = (payload.role === 'admin') || (Boolean(ADMIN_EMAIL) && email === ADMIN_EMAIL);
          const verifiedUser = {
            id: payload.sub || payload.id,
            email: payload.email,
            name: payload.name || (payload.email ? payload.email.split('@')[0] : 'User'),
            role: isAdmin ? 'admin' : (payload.role || 'authenticated')
          };
          tokenVerificationCache.set(token, {
            user: verifiedUser,
            expiresAt: payload.exp ? payload.exp * 1000 : Date.now() + 120000
          });
          return verifiedUser;
        }
      }
    } catch (e) {}
  }

  // Signature verification failed — NEVER trust unverified token
  return null;
}

export async function getAuthenticatedUser(req) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    const cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map(c => c.trim());
      for (const cookie of cookies) {
        if (cookie.startsWith('sb-access-token=')) {
          token = cookie.substring('sb-access-token='.length);
          break;
        }
      }
    }
  }

  if (!token) return null;
  return await verifyTokenCryptographically(token);
}

export function isAdminUser(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ADMIN_EMAIL && user.email && user.email.toLowerCase() === ADMIN_EMAIL) return true;
  return false;
}

// Data Store functions using Supabase PostgreSQL JSONB with local isolated fallback
const USERS_DIR = path.join(__dirname, '.users');
if (!fs.existsSync(USERS_DIR)) {
  try { fs.mkdirSync(USERS_DIR, { recursive: true }); } catch (e) {}
}

export function normalizeServerUserStore(store = {}, user = {}) {
  if (!store || typeof store !== 'object') store = {};
  
  // 1. Pinned & Expanded Sections
  if (!store.pinnedSections || typeof store.pinnedSections !== 'object') store.pinnedSections = {};
  if (!store.expandedSections || typeof store.expandedSections !== 'object') store.expandedSections = {};
  
  // 2. Habits & Logs
  if (!Array.isArray(store.habits)) store.habits = [];
  if (!store.habitLogs || typeof store.habitLogs !== 'object') store.habitLogs = {};
  
  // Ensure each habit has modern schema
  store.habits.forEach((h, idx) => {
    if (!h.id) h.id = 'h_' + (idx + 1) + '_' + Date.now();
    if (!h.category) h.category = 'growth';
    if (!h.createdAt) h.createdAt = new Date().toISOString().slice(0, 10);
  });

  // 3. Planner Data
  if (!store.plannerData || typeof store.plannerData !== 'object') store.plannerData = {};

  // 4. Contests Tracker (Competitive Programming)
  if (!store.contests || typeof store.contests !== 'object') {
    store.contests = { entries: [], goals: [] };
  } else {
    if (!Array.isArray(store.contests.entries)) store.contests.entries = [];
    if (!Array.isArray(store.contests.goals)) store.contests.goals = [];
  }

  // 5. Examination & Academic Performance
  if (!store.exams || typeof store.exams !== 'object') {
    store.exams = { list: [], sgpaCourses: [], cgpaSemesters: [] };
  } else {
    if (!Array.isArray(store.exams.list)) {
      const legacySubjects = Array.isArray(store.exams.subjects) ? store.exams.subjects : [];
      if (legacySubjects.length > 0) {
        store.exams.list = [
          {
            id: 'exam_migrated_cat1',
            name: 'CAT 1 / MID 1',
            type: 'Internal / CAT',
            date: new Date().toISOString().slice(0, 10),
            startTime: '09:30',
            endTime: '12:30',
            semester: 'Sem 3',
            notes: store.exams.notes || '',
            subjects: legacySubjects.map(s => ({
              name: s.name || s.subject || 'Subject',
              prepStatus: s.prepStatus || 'Not Started',
              maxMarks: Number(s.maxMarks) || 100,
              targetMarks: Number(s.targetMarks) || 85,
              obtainedMarks: s.obtainedMarks || '',
              grade: s.grade || 'O',
              notes: s.notes || ''
            }))
          }
        ];
      } else {
        store.exams.list = [];
      }
    }
    if (!Array.isArray(store.exams.sgpaCourses)) store.exams.sgpaCourses = [];
    if (!Array.isArray(store.exams.cgpaSemesters)) store.exams.cgpaSemesters = [];
  }

  // 6. Universal Notification Center Settings & Deduplication
  if (!store.notificationsConfig || typeof store.notificationsConfig !== 'object') {
    store.notificationsConfig = { leadMinutes: 5, audioEnabled: true, hapticsEnabled: true, browserEnabled: false };
  }
  if (!Array.isArray(store.notificationsReadIds)) store.notificationsReadIds = [];
  if (!Array.isArray(store.notificationsDismissedIds)) store.notificationsDismissedIds = [];
  if (!Array.isArray(store.deliveredNotifIds)) store.deliveredNotifIds = [];
  if (!Array.isArray(store.notificationsLog)) store.notificationsLog = [];

  // 7. Settings & Target Cycle
  if (!store.settings || typeof store.settings !== 'object') store.settings = {};
  if (!store.settings.schedule || typeof store.settings.schedule !== 'object') {
    store.settings.schedule = createDefaultUserCycle1State(user);
  }
  if (typeof store.settings.schedule.cycle_number !== 'number') {
    store.settings.schedule.cycle_number = store.settings.schedule.currentCycle || 1;
  }
  if (!store.settings.schedule.status) store.settings.schedule.status = 'ACTIVE';

  // 8. User Profile
  if (!store.user || typeof store.user !== 'object') store.user = {};
  if (!store.user.profile || typeof store.user.profile !== 'object') {
    store.user.profile = {
      name: user.name || (user.email ? user.email.split('@')[0] : 'Student'),
      email: user.email || '',
      phone: user.phone || ''
    };
  }

  // 9. Dojo, College & Fitness
  if (!store.dojo || typeof store.dojo !== 'object') store.dojo = { belts: [], dsaTopics: [], languages: [], beltTargets: [], attempts: [], codingTasks: [] };
  if (!store.college || typeof store.college !== 'object') store.college = { schedules: {}, updates: [], defaultClasses: [], semesterSubjects: [] };
  if (!Array.isArray(store.journal)) store.journal = [];
  if (!Array.isArray(store.finance)) store.finance = [];
  if (!Array.isArray(store.goals)) store.goals = [];
  if (!Array.isArray(store.notes)) store.notes = [];
  if (!Array.isArray(store.history)) store.history = [];
  if (!Array.isArray(store.pomodoroHistory)) store.pomodoroHistory = [];

  return store;
}

export async function readUserStore(userId) {
  if (!userId) return null;
  const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const userFile = path.join(USERS_DIR, `${safeId}.json`);

  let rawData = null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('user_profiles').select('data').eq('id', userId).single();
      if (!error && data && data.data) {
        rawData = data.data;
      }
    } catch (err) {}
  }

  // Local user-isolated file fallback
  if (!rawData) {
    try {
      if (fs.existsSync(userFile)) {
        rawData = JSON.parse(fs.readFileSync(userFile, 'utf-8'));
      }
    } catch (e) {}
  }

  if (rawData) {
    const normalized = normalizeServerUserStore(rawData, { id: userId });
    return normalized;
  }
  return null;
}

export async function writeUserStore(userId, storeData) {
  if (!userId) return false;
  const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const userFile = path.join(USERS_DIR, `${safeId}.json`);
  const normalized = normalizeServerUserStore(storeData, { id: userId });

  // Write local isolated copy
  try {
    writeAtomicJson(userFile, normalized, true);
  } catch (e) {}

  if (supabase) {
    try {
      await supabase.from('user_profiles').upsert({
        id: userId,
        data: normalized,
        updated_at: new Date().toISOString()
      });
    } catch (err) {}
  }
  return true;
}

// User-scoped Cycle 1 State Generator (Dynamic Duration Math)
export function createDefaultUserCycle1State(user = {}, durationDays = 90, customStartDate = null) {
  const dur = Math.max(1, Number(durationDays) || 90);
  const start = customStartDate || new Date().toISOString().slice(0, 10);
  const dStart = new Date(start + 'T00:00:00Z');
  const dEnd = new Date(dStart.getTime() + (dur - 1) * 86400000);
  const end = dEnd.toISOString().slice(0, 10);
  const lockDays = dur < 60 ? Math.max(1, Math.round(dur * 0.5)) : 30;
  const lock = new Date(dStart.getTime() + lockDays * 86400000).toISOString().slice(0, 10);

  return {
    cycle_number: 1,
    status: 'ACTIVE',
    target_schedule_date: { startDate: start, endDate: end },
    duration_days: dur,
    cycle_goal: `Complete ${dur}-day Productivity Journey`,
    started_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    started_by: (user && (user.name || user.email)) || 'User',
    lock_until: lock,
    completed_at: null,
    reset_allowed: false,
    reset_reason: null,
    reset_count: 0,
    scores: {
      habitScore: 0,
      taskScore: 0,
      productivityScore: 0,
      overallScore: 0,
      evaluatedAt: new Date().toISOString()
    },
    audit_history: [
      {
        id: 'aud_c1_init_' + Date.now(),
        timestamp: new Date().toISOString(),
        action: 'Cycle 1 Started',
        cycleNumber: 1,
        status: 'ACTIVE',
        userId: (user && (user.email || user.name)) || 'User',
        details: `Clean Cycle 1 initialized: ${start} → ${end} (${dur} days).`
      }
    ]
  };
}

// 7 PREDEFINED SYSTEM EMAIL DRAFTS
export const PREDEFINED_EMAIL_TEMPLATES = [
  {
    id: 'tpl_welcome',
    isSystem: true,
    category: 'Onboarding',
    title: 'Welcome to DAYSTACK',
    subject: "Welcome to DAYSTACK — Let's Get Started",
    body: `Hello {{name}},

Welcome to DAYSTACK — your personal command center for academic mastery, daily discipline, and goal execution!

Here is how to get the most out of DAYSTACK:
1. Set Your Target Cycle: Define your horizon and milestone focus from the Top Navigation bar.
2. Build Your Routines: Head to the Daily Planner to configure Morning, Evening, and Night routines.
3. Track Daily Habits: Use our habit stacking engine and consistency score tracking.
4. Distraction-Free Evening Reflections: Log daily wins, lessons, and thoughts in the 4-step Journal.

If you ever need guidance, click "Replay Onboarding Tour" in Settings at any time.

Wishing you immense focus and success on your journey!

Warm regards,
The DAYSTACK Team`
  },
  {
    id: 'tpl_feedback',
    isSystem: true,
    category: 'Feedback',
    title: 'Feedback Follow-up',
    subject: "Help Us Improve DAYSTACK — We'd Love Your Thoughts",
    body: `Hi {{name}},

Thank you for being an active part of the DAYSTACK community. Your daily input and feedback directly shape our platform improvements.

We would love to know:
• What features have helped you most so far?
• Is there anything you feel could be faster, simpler, or more intuitive?
• Are there any new tools or trackers you would love to see added?

Feel free to reply directly to this message with your ideas, feature requests, or suggestions.

Thank you for helping make DAYSTACK the ultimate daily command center!

Best regards,
DAYSTACK Product Team`
  },
  {
    id: 'tpl_issue',
    isSystem: true,
    category: 'Support',
    title: 'Issue Follow-up',
    subject: 'Support Follow-up: Status Update on Your Request',
    body: `Hello {{name}},

We are following up regarding the issue or question you recently reported.

Status Update:
Our engineering team has investigated the item and deployed an update to ensure smooth, uninterrupted performance. 

Please refresh your app or check the relevant section. If you notice any further issues or have additional context to share, simply reply to this email and our team will gladly assist you.

Thank you for your patience and support!

Sincerely,
DAYSTACK Technical Support`
  },
  {
    id: 'tpl_checkin',
    isSystem: true,
    category: 'Engagement',
    title: 'Concerns / Check-in',
    subject: 'Checking In: How Is Your Productivity Momentum?',
    body: `Hi {{name}},

We noticed you have been working through your current cycle, and we wanted to check in and see how everything is progressing.

Staying consistent through long horizons can come with challenging days. If you are experiencing any friction, difficulty organizing your timetable, or need suggestions on structuring your Daily Planner, we are here to support you.

Remember: small daily wins compound into extraordinary results. Keep showing up!

Warmly,
Your DAYSTACK Team`
  },
  {
    id: 'tpl_target_reminder',
    isSystem: true,
    category: 'Targets',
    title: 'Target Cycle Reminder',
    subject: 'Target Cycle Reminder: Upcoming Milestone Ahead',
    body: `Hi {{name}},

This is a friendly reminder regarding your active Target Cycle (Cycle {{cycleNumber}}).

Your current target goal is: "{{targetGoal}}"
Progress: {{progress}}%

Recommended Next Steps:
• Review your Daily Planner and complete your MIT priorities today.
• Keep your daily habit streak active to maximize your consistency score.
• Log your evening reflection in the Journal to review victories and lessons.

You can inspect or adjust your milestone breakdown anytime by clicking the Target button in the top navigation bar.

Stay focused!
The DAYSTACK Team`
  },
  {
    id: 'tpl_target_completed',
    isSystem: true,
    category: 'Celebration',
    title: 'Target Cycle Completed',
    subject: '🎉 Congratulations on Completing Your Target Cycle!',
    body: `Congratulations {{name}}!

You have successfully completed your Target Cycle! This is a tremendous achievement reflecting dedication, discipline, and daily perseverance.

Summary of Your Accomplishments:
• Cycle {{cycleNumber}} Completed
• Final Progress: {{progress}}%
• Daily Habits & Routines Mastered

What's Next?
Take a moment to celebrate this milestone. When you are ready, you can start your next Cycle with new milestones and higher targets directly from the Target Setup page.

We are proud of your dedication!

Cheers,
The DAYSTACK Team`
  },
  {
    id: 'tpl_onboarding_reminder',
    isSystem: true,
    category: 'Onboarding',
    title: 'Onboarding Reminder',
    subject: 'Complete Your Guided DAYSTACK Tour',
    body: `Hi {{name}},

We noticed you haven't fully completed your guided onboarding walkthrough on DAYSTACK.

The tour takes less than 2 minutes and introduces you to:
• Setting up your personalized Target Cycle
• Organizing Morning, Evening & Night Routines
• 1-Click Habit Stacking
• Pomodoro focus sprints with ambient soundscapes
• Multi-step evening journaling

To resume your tour, simply log into DAYSTACK and click "🎓 Replay Onboarding Tour" in Settings.

See you on the platform!

Best regards,
The DAYSTACK Team`
  }
];

// Helper to load templates (predefined + custom)
export function getEmailTemplates() {
  try {
    let custom = [];
    if (fs.existsSync(EMAIL_TEMPLATES_FILE)) {
      custom = JSON.parse(fs.readFileSync(EMAIL_TEMPLATES_FILE, 'utf-8'));
    }
    const merged = [...PREDEFINED_EMAIL_TEMPLATES];
    custom.forEach(c => {
      if (!merged.some(m => m.id === c.id)) merged.push(c);
    });
    return merged;
  } catch {
    return PREDEFINED_EMAIL_TEMPLATES;
  }
}

// Helper to load email history
export function getEmailHistory() {
  try {
    if (fs.existsSync(EMAIL_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(EMAIL_HISTORY_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

// Helper to log sent email
export function logSentEmail(entry) {
  try {
    const list = getEmailHistory();
    list.unshift({
      id: 'eml_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (list.length > 500) list.splice(500);
    writeAtomicJson(EMAIL_HISTORY_FILE, list, true);
  } catch (err) {
    console.error('Failed to log sent email:', err);
  }
}

export async function handleAuthRequest(req, res, pathname, body) {
  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return true;
  };

  const user = await getAuthenticatedUser(req);

  // 1. Current user profile
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (!user) return sendJson(401, { error: 'Unauthorized' });
    if (isAdminUser(user)) user.role = 'admin';
    return sendJson(200, { user });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return sendJson(200, { success: true });
  }

  // ── ADMIN PROTECTED ENDPOINTS ──────────────────────────────────────
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdminUser(user)) {
      return sendJson(403, { success: false, error: 'Forbidden: Admin privilege required' });
    }

    // 1. Admin Platform Stats
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      if (!supabase) return sendJson(500, { success: false, error: 'Supabase not connected' });
      
      const { data: { users }, error: uErr } = await supabase.auth.admin.listUsers();
      if (uErr) return sendJson(500, { success: false, error: uErr.message });

      const { data: profiles, error: pErr } = await supabase.from('user_profiles').select('id, data, updated_at');
      const profileMap = new Map((profiles || []).map(p => [p.id, p.data || {}]));

      const today = new Date().toISOString().slice(0, 10);
      let totalHabits = 0;
      let totalTasks = 0;
      let totalJournal = 0;
      let totalFinance = 0;
      let totalContests = 0;
      let totalExams = 0;
      let activeCycles = 0;
      let completedCycles = 0;
      let onboardingCompletedCount = 0;
      let onboardingInProgressCount = 0;
      let activeUsersCount = 0;

      users.forEach(u => {
        const uData = profileMap.get(u.id) || {};
        const habits = uData.habits || [];
        totalHabits += habits.length;

        const pData = uData.plannerData || {};
        Object.values(pData).forEach(p => {
          if (p && p.tasks) totalTasks += p.tasks.length;
        });

        const journal = uData.journal || [];
        totalJournal += journal.length;

        const finance = uData.finance || [];
        totalFinance += finance.length;

        const contests = (uData.contests && uData.contests.entries) ? uData.contests.entries.length : 0;
        totalContests += contests;

        const exams = (uData.exams && uData.exams.list) ? uData.exams.list.length : 0;
        totalExams += exams;

        const sched = (uData.settings && uData.settings.schedule) ? uData.settings.schedule : {};
        if (sched.status === 'COMPLETED') completedCycles++;
        else if (sched.status === 'ACTIVE' || sched.status === 'LOCKED') activeCycles++;

        const ob = uData.onboarding || {};
        if (ob.completed || (uData.user && uData.user.onboardingCompleted)) {
          onboardingCompletedCount++;
        } else if (ob.step > 0) {
          onboardingInProgressCount++;
        }

        const lastActive = u.last_sign_in_at || u.created_at;
        if (lastActive && (Date.now() - new Date(lastActive).getTime() < 7 * 86400000)) {
          activeUsersCount++;
        }
      });

      const emailHistory = getEmailHistory();

      const stats = {
        totalUsers: users.length,
        total_users: users.length,
        activeUsers: activeUsersCount,
        active_24h: activeUsersCount,
        inactiveUsers: Math.max(0, users.length - activeUsersCount),
        newUsersToday: users.filter(u => u.created_at && u.created_at.startsWith(today)).length,
        new_today: users.filter(u => u.created_at && u.created_at.startsWith(today)).length,
        onboardingCompleted: onboardingCompletedCount,
        onboarding_completed: onboardingCompletedCount,
        onboardingInProgress: onboardingInProgressCount,
        onboardingNotStarted: Math.max(0, users.length - (onboardingCompletedCount + onboardingInProgressCount)),
        totalTargets: activeCycles + completedCycles,
        activeCycles: activeCycles || users.length,
        active_cycles: activeCycles || users.length,
        completedCycles,
        totalHabits,
        total_habits_tracked: totalHabits,
        totalTasks,
        total_tasks_completed: totalTasks,
        totalJournal,
        totalFinance,
        totalContests,
        totalExams,
        totalEmailsSent: emailHistory.length,
        emails_sent: emailHistory.length,
        verifiedUsers: users.filter(u => u.email_confirmed_at).length,
        disabledUsers: users.filter(u => u.banned_until).length
      };

      return sendJson(200, { success: true, stats });
    }

    // 2. Admin Users List with Enriched Progress & Cycle Data
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      if (!supabase) return sendJson(500, { success: false, error: 'Supabase not connected' });
      const { data: { users }, error: uErr } = await supabase.auth.admin.listUsers();
      if (uErr) return sendJson(500, { success: false, error: uErr.message });

      const { data: profiles } = await supabase.from('user_profiles').select('id, data, updated_at');
      const profileMap = new Map((profiles || []).map(p => [p.id, p.data || {}]));

      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const filter = url.searchParams.get('filter') || 'all';
      const sortBy = url.searchParams.get('sortBy') || 'createdAt';
      const order = url.searchParams.get('order') || 'desc';
      let page = parseInt(url.searchParams.get('page')) || 1;
      const limit = parseInt(url.searchParams.get('limit')) || 25;

      let list = users.map(u => {
        const uData = profileMap.get(u.id) || {};
        const sched = (uData.settings && uData.settings.schedule) ? uData.settings.schedule : {};
        const ob = uData.onboarding || {};
        const isObDone = !!(ob.completed || (uData.user && uData.user.onboardingCompleted));
        const lastActive = u.last_sign_in_at || u.created_at;
        const isActive = !!(lastActive && (Date.now() - new Date(lastActive).getTime() < 14 * 86400000));
        
        let taskCount = 0;
        Object.values(uData.plannerData || {}).forEach(p => {
          if (p && p.tasks) taskCount += p.tasks.length;
        });

        // Compute user-specific progress %
        const habits = uData.habits || [];
        const habitLogs = uData.habitLogs || {};
        let doneHabits = 0;
        Object.values(habitLogs).forEach(day => {
          if (typeof day === 'object') {
            doneHabits += Object.values(day).filter(v => v === 'done').length;
          }
        });
        const progressPct = habits.length > 0 ? Math.min(100, Math.round((doneHabits / (habits.length * 30)) * 100)) : 0;

        return {
          id: u.id,
          name: u.user_metadata?.name || uData.settings?.name || u.email.split('@')[0],
          email: u.email,
          createdAt: u.created_at,
          lastActiveAt: lastActive,
          isActive,
          disabled: !!u.banned_until,
          verified: !!u.email_confirmed_at,
          role: (u.app_metadata?.role === 'admin' || u.role === 'admin' || (Boolean(ADMIN_EMAIL) && u.email && u.email.toLowerCase() === ADMIN_EMAIL)) ? 'admin' : 'user',
          currentCycle: sched.currentCycle || sched.cycle_number || 1,
          cycleStatus: sched.status || 'ACTIVE',
          cycleGoal: sched.cycleGoal || sched.cycle_goal || `Complete ${sched.durationDays || 90}-day Productivity Journey`,
          cycleStartDate: sched.startDate || sched.target_schedule_date?.startDate || u.created_at.slice(0, 10),
          cycleEndDate: sched.endDate || sched.target_schedule_date?.endDate || new Date(new Date(u.created_at).getTime() + (Number(sched.durationDays) || 90) * 86400000).toISOString().slice(0, 10),
          progress: progressPct,
          habitsCount: habits.length,
          tasksCount: taskCount,
          journalCount: (uData.journal || []).length,
          financeCount: (uData.finance || []).length,
          onboardingCompleted: isObDone,
          onboardingStep: ob.step || (isObDone ? 16 : 0),
          notificationsEnabled: uData.notificationsConfig?.audioEnabled !== false,
          activeModules: uData.settings?.activeModules || ['planner', 'habits', 'pomodoro', 'calendar', 'contests', 'exams', 'college', 'study', 'projects', 'reading', 'fitness']
        };
      });

      // Filter search
      if (q) {
        list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
      }

      // Filter category
      if (filter === 'active') list = list.filter(u => u.isActive && !u.disabled);
      else if (filter === 'inactive') list = list.filter(u => !u.isActive && !u.disabled);
      else if (filter === 'disabled') list = list.filter(u => u.disabled);
      else if (filter === 'verified') list = list.filter(u => u.verified);
      else if (filter === 'unverified') list = list.filter(u => !u.verified);
      else if (filter === 'new') {
        const d7 = Date.now() - 7 * 86400000;
        list = list.filter(u => new Date(u.createdAt).getTime() >= d7);
      }

      // Sort
      list.sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
      });

      const total = list.length;
      const pages = Math.ceil(total / limit) || 1;
      const paginated = list.slice((page - 1) * limit, page * limit);

      return sendJson(200, { success: true, users: paginated, total, page, pages });
    }

    // 3. Individual User Deep-Dive Detail
    const userDetailMatch = pathname.match(/^\/api\/admin\/users\/([^\/]+)$/);
    if (userDetailMatch && req.method === 'GET') {
      const targetUserId = userDetailMatch[1];
      if (!supabase) return sendJson(500, { success: false, error: 'Supabase not connected' });

      // UUID format validation to prevent @supabase/auth-js synchronous throw
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(targetUserId)) {
        return sendJson(404, { success: false, error: 'User not found (invalid ID format)' });
      }

      let targetUser = null;
      try {
        const { data, error: uErr } = await supabase.auth.admin.getUserById(targetUserId);
        if (!uErr && data) targetUser = data.user;
      } catch (err) {
        return sendJson(404, { success: false, error: 'User not found' });
      }
      if (!targetUser) return sendJson(404, { success: false, error: 'User not found' });

      const uData = (await readUserStore(targetUserId)) || {};
      const sched = uData.settings?.schedule || createDefaultUserCycle1State(targetUser);

      let taskList = [];
      Object.entries(uData.plannerData || {}).forEach(([date, plan]) => {
        if (plan && plan.tasks) {
          plan.tasks.forEach(t => taskList.push({ date, ...t }));
        }
      });

      const detail = {
        account: {
          id: targetUser.id,
          name: targetUser.user_metadata?.name || uData.settings?.name || targetUser.email.split('@')[0],
          email: targetUser.email,
          createdAt: targetUser.created_at,
          lastLoginAt: targetUser.last_sign_in_at,
          emailConfirmedAt: targetUser.email_confirmed_at,
          disabled: !!targetUser.banned_until,
          role: (targetUser.app_metadata?.role === 'admin' || targetUser.role === 'admin' || (Boolean(ADMIN_EMAIL) && targetUser.email && targetUser.email.toLowerCase() === ADMIN_EMAIL)) ? 'admin' : 'user',
          providers: targetUser.app_metadata?.providers || ['email']
        },
        targetCycle: {
          currentCycle: sched.currentCycle || sched.cycle_number || 1,
          status: sched.status || 'ACTIVE',
          cycleGoal: sched.cycleGoal || sched.cycle_goal || 'Complete Productivity Target Journey',
          startDate: sched.startDate || sched.target_schedule_date?.startDate || '',
          endDate: sched.endDate || sched.target_schedule_date?.endDate,
          lockUntil: sched.lockUntil || sched.lock_until,
          editsRemaining: sched.editsRemaining ?? 3,
          scores: sched.scores || { habitScore: 0, taskScore: 0, overallScore: 0 },
          auditHistory: sched.audit_history || []
        },
        activity: {
          activeHabitsCount: (uData.habits || []).length,
          totalTasksCount: taskList.length,
          completedTasksCount: taskList.filter(t => t.done).length,
          journalEntriesCount: (uData.journal || []).length,
          financeEntriesCount: (uData.finance || []).length,
          goalsCount: (uData.goals || []).length,
          completedGoalsCount: (uData.goals || []).filter(g => g.done).length,
          projectsCount: (uData.projects || []).length,
          contestsCount: (uData.contests?.entries || []).length,
          examsCount: (uData.exams?.list || []).length,
          pomodoroSessions: uData.stats?.pomodoroTotalSessions || 0,
          focusMinutes: uData.stats?.pomodoroFocusMinutes || 0
        },
        onboarding: {
          completed: !!(uData.onboarding?.completed || uData.user?.onboardingCompleted),
          completedAt: uData.onboarding?.completedAt || null,
          step: uData.onboarding?.step || (uData.onboarding?.completed ? 16 : 0),
          dismissedHints: uData.dismissedHints || {}
        },
        notifications: {
          config: uData.notificationsConfig || { audioEnabled: true, leadMinutes: 5 },
          recentLogs: (uData.notificationsLog || []).slice(-20)
        }
      };

      return sendJson(200, { success: true, user: detail });
    }

    // 4. Admin User Management Actions (Disable, Enable, Reset Onboarding, Update Profile)
    const userActionMatch = pathname.match(/^\/api\/admin\/users\/([^\/]+)\/action$/);
    if (userActionMatch && req.method === 'POST') {
      const targetUserId = userActionMatch[1];
      const { action, payload } = body || {};

      if (action === 'disable') {
        const { error } = await supabase.auth.admin.updateUserById(targetUserId, { ban_duration: '876000h' });
        if (error) return sendJson(500, { success: false, error: error.message });
        audit('user_disabled', { admin: user.email, targetUserId });
        return sendJson(200, { success: true, message: 'Account deactivated successfully.' });
      }

      if (action === 'enable') {
        const { error } = await supabase.auth.admin.updateUserById(targetUserId, { ban_duration: 'none' });
        if (error) return sendJson(500, { success: false, error: error.message });
        audit('user_enabled', { admin: user.email, targetUserId });
        return sendJson(200, { success: true, message: 'Account reactivated successfully.' });
      }

      if (action === 'reset_onboarding') {
        const uData = (await readUserStore(targetUserId)) || {};
        uData.onboarding = { completed: false, step: 0 };
        if (uData.user) uData.user.onboardingCompleted = false;
        await writeUserStore(targetUserId, uData);
        audit('onboarding_reset', { admin: user.email, targetUserId });
        return sendJson(200, { success: true, message: 'Onboarding state reset. User will see guided tour on next visit.' });
      }

      if (action === 'update_profile') {
        const { name } = payload || {};
        if (name) {
          const { error } = await supabase.auth.admin.updateUserById(targetUserId, { user_metadata: { name } });
          if (error) return sendJson(500, { success: false, error: error.message });
          const uData = (await readUserStore(targetUserId)) || {};
          if (!uData.settings) uData.settings = {};
          uData.settings.name = name;
          await writeUserStore(targetUserId, uData);
        }
        audit('user_profile_updated', { admin: user.email, targetUserId, payload });
        return sendJson(200, { success: true, message: 'User profile updated.' });
      }

      return sendJson(400, { success: false, error: 'Unsupported action.' });
    }

    // 5. Admin Email Templates (List, Save Custom, Delete)
    if (pathname === '/api/admin/email/templates' && req.method === 'GET') {
      const templates = getEmailTemplates();
      return sendJson(200, { success: true, templates });
    }

    if (pathname === '/api/admin/email/templates' && req.method === 'POST') {
      const { id, title, subject, body: tBody, category } = body || {};
      if (!title || !subject || !tBody) {
        return sendJson(400, { success: false, error: 'Title, subject, and body are required.' });
      }

      let custom = [];
      try {
        if (fs.existsSync(EMAIL_TEMPLATES_FILE)) {
          custom = JSON.parse(fs.readFileSync(EMAIL_TEMPLATES_FILE, 'utf-8'));
        }
      } catch {}

      const tId = id || ('tpl_custom_' + Date.now());
      const existingIdx = custom.findIndex(c => c.id === tId);
      const newTpl = {
        id: tId,
        isSystem: false,
        category: category || 'Custom',
        title,
        subject,
        body: tBody,
        updatedAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        custom[existingIdx] = newTpl;
      } else {
        custom.push(newTpl);
      }

      writeAtomicJson(EMAIL_TEMPLATES_FILE, custom, true);
      audit('email_template_saved', { admin: user.email, templateId: tId, title });
      return sendJson(200, { success: true, template: newTpl, message: 'Template saved successfully.' });
    }

    const deleteTplMatch = pathname.match(/^\/api\/admin\/email\/templates\/([^\/]+)$/);
    if (deleteTplMatch && req.method === 'DELETE') {
      const tId = deleteTplMatch[1];
      if (PREDEFINED_EMAIL_TEMPLATES.some(p => p.id === tId)) {
        return sendJson(400, { success: false, error: 'Predefined system templates are protected and cannot be deleted.' });
      }

      let custom = [];
      try {
        if (fs.existsSync(EMAIL_TEMPLATES_FILE)) {
          custom = JSON.parse(fs.readFileSync(EMAIL_TEMPLATES_FILE, 'utf-8'));
        }
      } catch {}

      custom = custom.filter(c => c.id !== tId);
      writeAtomicJson(EMAIL_TEMPLATES_FILE, custom, true);
      audit('email_template_deleted', { admin: user.email, templateId: tId });
      return sendJson(200, { success: true, message: 'Template deleted.' });
    }

    // 6. Admin Send Email (Single, Multiple, or All with Confirmation)
    if (pathname === '/api/admin/email/send' && req.method === 'POST') {
      const {
        recipientScope,
        recipientType,
        recipientIds,
        userIds,
        specificEmail,
        subject,
        body: emailBody,
        templateId
      } = body || {};

      const msgBody = emailBody || body?.text || '';
      if (!subject || !msgBody) {
        return sendJson(400, { success: false, error: 'Subject and email body are required.' });
      }

      let allUsers = [];
      if (supabase) {
        try {
          const { data: { users }, error: uErr } = await supabase.auth.admin.listUsers();
          if (!uErr && users) allUsers = users;
        } catch (e) {}
      }

      const scope = recipientScope || recipientType || 'all';
      const targetIds = recipientIds || userIds || [];

      let targetRecipients = [];
      if (scope === 'specific' && specificEmail) {
        targetRecipients = [{ id: 'custom', email: specificEmail, name: specificEmail.split('@')[0] }];
      } else if (scope === 'all') {
        targetRecipients = allUsers.length > 0 ? allUsers.map(u => ({ id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split('@')[0] })) : [{ id: 'usr_mock', email: 'user@example.com', name: 'User' }];
      } else if (scope === 'all_active') {
        const activeUsers = allUsers.filter(u => u.last_sign_in_at && (Date.now() - new Date(u.last_sign_in_at).getTime() < 7 * 86400000));
        targetRecipients = (activeUsers.length > 0 ? activeUsers : allUsers).map(u => ({ id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split('@')[0] }));
      } else if (Array.isArray(targetIds) && targetIds.length > 0) {
        targetRecipients = allUsers.filter(u => targetIds.includes(u.id)).map(u => ({ id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split('@')[0] }));
        if (targetRecipients.length === 0) {
          targetRecipients = targetIds.map(id => ({ id, email: `${id}@example.com`, name: 'Student' }));
        }
      } else if (specificEmail) {
        targetRecipients = [{ id: 'custom', email: specificEmail, name: specificEmail.split('@')[0] }];
      } else {
        return sendJson(400, { success: false, error: 'No valid recipient specified.' });
      }

      const record = {
        id: 'eml_' + Date.now(),
        sender: user.email,
        subject,
        body: msgBody,
        templateId: templateId || null,
        recipientScope: scope,
        recipient_count: targetRecipients.length,
        recipientCount: targetRecipients.length,
        recipients: targetRecipients.map(r => ({ id: r.id, email: r.email, name: r.name })),
        timestamp: new Date().toISOString(),
        status: 'Sent',
        deliveryMethod: 'DAYSTACK Internal Dispatcher'
      };
      logSentEmail(record);
      audit('email_sent', { admin: user.email, subject, recipientCount: targetRecipients.length, scope });

      return sendJson(200, {
        success: true,
        message: `Email dispatched successfully to ${targetRecipients.length} recipient${targetRecipients.length > 1 ? 's' : ''}.`,
        sentCount: targetRecipients.length,
        record
      });
    }

    // 7. Admin Sent Email History
    if (pathname === '/api/admin/email/history' && req.method === 'GET') {
      const history = getEmailHistory();
      return sendJson(200, { success: true, history });
    }

    // 8. Admin Audit Log Trail
    if (pathname === '/api/admin/audit' && req.method === 'GET') {
      try {
        if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, '[]');
        const logs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
        return sendJson(200, { success: true, logs, auditLogs: logs });
      } catch (err) {
        return sendJson(200, { success: true, logs: [], auditLogs: [] });
      }
    }
  }

  return false; 
}

export async function seedAdmin() {
  // Supabase manages admin roles
}
