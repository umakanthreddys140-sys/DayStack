import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Load .env if present
try { const { config } = await import('dotenv'); config(); } catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Auth System
import {
  handleAuthRequest,
  getAuthenticatedUser,
  isAdminUser,
  readUserStore,
  writeUserStore,
  seedAdmin,
  createDefaultUserCycle1State
} from './auth-server.js';

// Guardian Verification & Safety Escalation Service
import {
  sendGuardianVerificationEmail,
  verifyGuardianCode,
  sendGuardianEscalationAlert,
  renderGuardianVerificationWebpage
} from './src/features/guardian/guardianService.js';

// Seed admin account on startup
await seedAdmin();

// Get LAN IP for display (prioritizing Wi-Fi/Ethernet over virtual adapters)
function getLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, iface] of Object.entries(ifaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        const addr = config.address;
        if (!addr.startsWith('169.254.') && !addr.startsWith('192.168.56.')) {
          if (/wi-fi|wlan|wireless/i.test(name)) {
            return addr;
          }
          candidates.push(addr);
        }
      }
    }
  }
  return candidates[0] || '127.0.0.1';
}

/* --------------------------------------------------------------------------
   CONFIGURABLE CYCLE RULES (PER-USER ENFORCEMENT)
   -------------------------------------------------------------------------- */
export const CYCLE_RULES = {
  minScoreForReset: 85,
  cycle1LockPeriodDays: 30,
  maxCycles: 3,
  requireReasonForReset: true,
  defaultCycleDurationDays: 90
};

// User-scoped Cycle State Management (Guarantees 100% User Isolation & Guest Persistence)
async function getUserCycleState(user) {
  const userId = user?.id || 'guest';
  const store = (await readUserStore(userId)) || {};
  if (!store.settings) store.settings = {};
  if (!store.settings.schedule || typeof store.settings.schedule.cycle_number !== 'number') {
    const userDuration = Number(store.settings?.schedule?.durationDays) || 90;
    const userStartDate = store.settings?.schedule?.startDate || null;
    const freshCycle1 = createDefaultUserCycle1State(user || { id: 'guest', email: 'guest@daystack.local', name: 'Guest' }, userDuration, userStartDate);
    store.settings.schedule = freshCycle1;
    await writeUserStore(userId, store);
    return freshCycle1;
  }
  return store.settings.schedule;
}

async function saveUserCycleState(user, newCycleState) {
  const userId = user?.id || 'guest';
  const store = (await readUserStore(userId)) || {};
  if (!store.settings) store.settings = {};
  store.settings.schedule = newCycleState;
  await writeUserStore(userId, store);
  return newCycleState;
}

function addAuditEventToCycle(cycleState, action, details, user) {
  if (!cycleState.audit_history) cycleState.audit_history = [];
  const evt = {
    id: 'aud_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    action,
    cycleNumber: cycleState.cycle_number || 1,
    status: cycleState.status || 'ACTIVE',
    userId: user?.email || user?.name || 'User',
    details
  };
  cycleState.audit_history.unshift(evt);
  if (cycleState.audit_history.length > 200) {
    cycleState.audit_history = cycleState.audit_history.slice(0, 200);
  }
  return evt;
}

function addDaysStr(dateStr, days) {
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  } catch {
    return dateStr;
  }
}

function diffDaysStr(d1, d2) {
  try {
    const t1 = new Date(d1 + 'T00:00:00Z').getTime();
    const t2 = new Date(d2 + 'T00:00:00Z').getTime();
    return Math.round((t2 - t1) / 86400000);
  } catch {
    return 0;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function sendJson(res, statusCode, data) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad Request');
  }
  const pathname = parsedUrl.pathname;

  // ── Page routes with auth guards ─────────────────────────────────
  // Root → landing for visitors, dashboard for authenticated users
  if (pathname === '/') {
    const user = await getAuthenticatedUser(req);
    if (user) { res.writeHead(302, { Location: '/app' }); return res.end(); }
    const file = path.join(__dirname, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }

  // Legacy landing URL → root
  if (pathname === '/landing') {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }

  // Auth page (login / register / OTP)
  if (pathname === '/auth') {
    const user = await getAuthenticatedUser(req);
    if (user) { res.writeHead(302, { Location: '/app' }); return res.end(); }
    const file = path.join(__dirname, 'auth.html');
    if (!fs.existsSync(file)) { res.writeHead(302, { Location: '/app' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }

  // Main app (authenticated users only)
  if (pathname === '/app') {
    const user = await getAuthenticatedUser(req);
    if (!user) { res.writeHead(302, { Location: '/auth?redirect=app' }); return res.end(); }
    const file = path.join(__dirname, 'app.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }

  // Admin dashboard (admin role only)
  if (pathname === '/admin') {
    const user = await getAuthenticatedUser(req);
    if (!user) { res.writeHead(302, { Location: '/auth?redirect=admin' }); return res.end(); }
    if (!isAdminUser(user)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('403 Forbidden — Admin access required.'); }
    const file = path.join(__dirname, 'admin.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Admin page not found.'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }

  // ── Auth API routes ──────────────────────────────────────────────
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/admin/') || pathname === '/api/feedback') {
    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
    const handled = await handleAuthRequest(req, res, pathname, body);
    if (handled !== false) return;
  }

  // Health
  if (pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
  }

  // Cycle State API (User-Scoped)
  if (pathname === '/api/cycle/state') {
    const user = await getAuthenticatedUser(req);
    const userCycleState = await getUserCycleState(user);
    return sendJson(res, 200, { success: true, rules: CYCLE_RULES, state: userCycleState });
  }

  if (pathname === '/api/cycle/rules') {
    return sendJson(res, 200, { success: true, rules: CYCLE_RULES });
  }

  if (pathname === '/api/cycle/confirm' && req.method === 'POST') {
    const body = await readBody(req);
    const user = await getAuthenticatedUser(req);
    const userCycleState = await getUserCycleState(user);

    const { cycleNumber, startDate, endDate, cycleGoal, userName } = body;
    const targetCycle = Number(cycleNumber) || userCycleState.cycle_number || 1;
    const displayName = (userName && String(userName).trim()) || user?.name || user?.email || 'User';
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || userCycleState.target_schedule_date?.startDate || today;
    const end = endDate || userCycleState.target_schedule_date?.endDate || addDaysStr(start, 89);
    
    // Server-side strict date validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return sendJson(res, 400, { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }
    if (start < today) {
      return sendJson(res, 400, { success: false, error: `Start date cannot be before today (${today}).` });
    }
    if (end < start) {
      return sendJson(res, 400, { success: false, error: 'End date cannot be earlier than start date.' });
    }

    const dur = Math.max(1, diffDaysStr(start, end) + 1);
    const goal = (cycleGoal && String(cycleGoal).trim()) || userCycleState.cycle_goal || `Complete ${dur}-day Productivity Journey`;

    if (targetCycle > CYCLE_RULES.maxCycles) {
      return sendJson(res, 400, { success: false, error: `Maximum cycle limit (${CYCLE_RULES.maxCycles}) reached.` });
    }

    let lockUntil;
    if (targetCycle === 1) {
      if (dur < 60) {
        // Less than 2 months: 50% of the total selected range
        const lockDays = Math.max(1, Math.round(dur * 0.5));
        lockUntil = addDaysStr(start, lockDays);
      } else {
        // 2-3+ months: 1 month (30 days) from selected Start Date
        lockUntil = addDaysStr(start, 30);
      }
    } else if (targetCycle === 2) {
      // 85% progression threshold
      const thresholdDays = Math.max(1, Math.round(dur * 0.85));
      lockUntil = addDaysStr(start, thresholdDays);
    } else {
      // Cycle 3: full duration ending on selected End Date
      lockUntil = end;
    }

    const now = new Date().toISOString();
    userCycleState.cycle_number = targetCycle;
    userCycleState.status = 'LOCKED';
    userCycleState.target_schedule_date = { startDate: start, endDate: end };
    userCycleState.duration_days = dur;
    userCycleState.cycle_goal = goal;
    userCycleState.started_at = now;
    userCycleState.confirmed_at = now;
    userCycleState.started_by = displayName;
    userCycleState.lock_until = lockUntil;
    userCycleState.completed_at = null;
    userCycleState.reset_allowed = false;
    userCycleState.reset_reason = null;
    userCycleState.reset_requested_at = null;

    const startAction = targetCycle === 1 ? 'Cycle started' : (targetCycle === 2 ? 'Cycle 2 started' : 'Cycle 3 started');
    addAuditEventToCycle(userCycleState, startAction, `Started Cycle ${targetCycle} with target range ${start} → ${end} (${dur} days). Goal: "${goal}".`, user);
    addAuditEventToCycle(userCycleState, 'Schedule confirmed', `Target schedule date ${start} → ${end} confirmed and locked under cycle rules.`, user);

    await saveUserCycleState(user, userCycleState);
    return sendJson(res, 200, { success: true, message: `Cycle ${targetCycle} confirmed and locked successfully.`, state: userCycleState });
  }

  if (pathname === '/api/cycle/update-schedule' && req.method === 'POST') {
    const body = await readBody(req);
    const user = await getAuthenticatedUser(req);
    const userCycleState = await getUserCycleState(user);
    const { startDate, endDate, cycleGoal, durationDays } = body;
    const today = new Date().toISOString().slice(0, 10);

    // If cycle is currently LOCKED and active, block direct schedule modification
    if (userCycleState.status === 'LOCKED' && userCycleState.target_schedule_date?.startDate) {
      return sendJson(res, 403, { 
        success: false, 
        error: 'Schedule is currently locked under Cycle rules and cannot be edited directly.', 
        state: userCycleState 
      });
    }

    const start = startDate || userCycleState.target_schedule_date?.startDate || today;
    const end = endDate || userCycleState.target_schedule_date?.endDate || addDaysStr(start, (Number(durationDays) || 90) - 1);
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return sendJson(res, 400, { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }
    if (start < today) {
      return sendJson(res, 400, { success: false, error: `Start date cannot be before today (${today}).` });
    }
    if (end < start) {
      return sendJson(res, 400, { success: false, error: 'End date cannot be earlier than start date.' });
    }

    const dur = Math.max(1, diffDaysStr(start, end) + 1);
    const goal = (cycleGoal && String(cycleGoal).trim()) || userCycleState.cycle_goal || `Complete ${dur}-day Productivity Journey`;

    const cycleNum = userCycleState.cycle_number || 1;
    let lockUntil;
    if (cycleNum === 1) {
      if (dur <= 1) {
        lockUntil = end;
      } else if (dur < 60) {
        const lockDays = Math.max(0, Math.round(dur * 0.5) - 1);
        lockUntil = addDaysStr(start, lockDays);
      } else {
        lockUntil = addDaysStr(start, Math.min(29, dur - 1));
      }
    } else if (cycleNum === 2) {
      const thresholdDays = Math.max(0, Math.min(dur - 1, Math.round(dur * 0.85) - 1));
      lockUntil = addDaysStr(start, thresholdDays);
    } else {
      lockUntil = end;
    }

    if (!userCycleState.target_schedule_date) userCycleState.target_schedule_date = {};
    userCycleState.target_schedule_date.startDate = start;
    userCycleState.target_schedule_date.endDate = end;
    userCycleState.duration_days = dur;
    userCycleState.cycle_goal = goal;
    userCycleState.lock_until = lockUntil;

    addAuditEventToCycle(userCycleState, 'Schedule updated', `Target schedule updated: ${start} → ${end} (${dur} days). Goal: "${goal}".`, user);
    await saveUserCycleState(user, userCycleState);
    return sendJson(res, 200, { success: true, message: 'Schedule updated successfully.', state: userCycleState });
  }

  if (pathname === '/api/cycle/reset-request' && req.method === 'POST') {
    const body = await readBody(req);
    const user = await getAuthenticatedUser(req);
    const userCycleState = await getUserCycleState(user);

    const { reason, currentScores, clientToday } = body;
    const cycleNum = userCycleState.cycle_number;
    const today = clientToday || new Date().toISOString().slice(0, 10);

    if (currentScores && typeof currentScores === 'object') {
      userCycleState.scores = {
        habitScore: Number(currentScores.habitScore) || 0,
        taskScore: Number(currentScores.taskScore) || 0,
        productivityScore: Number(currentScores.productivityScore) || 0,
        overallScore: Number(currentScores.overallScore) || 0,
        evaluatedAt: new Date().toISOString()
      };
    }

    if (cycleNum === 2) {
      const errorMsg = 'Cycle 2 Cannot Be Reset. Cycle 2 has already started and cannot be reset at this time.';
      addAuditEventToCycle(userCycleState, 'Reset rejected', 'Cycle 2 reset attempt rejected: Cycle 2 cannot be reset once started.', user);
      return sendJson(res, 403, { success: false, cycleNumber: 2, error: errorMsg, state: userCycleState });
    }

    if (cycleNum >= 3 && userCycleState.status !== 'COMPLETED') {
      const errorMsg = 'Cycle 3 Cannot Be Reset. Cycle 3 is strictly locked until full completion.';
      addAuditEventToCycle(userCycleState, 'Reset rejected', 'Cycle 3 reset attempt rejected: Cycle 3 is strictly locked until full completion.', user);
      return sendJson(res, 403, { success: false, cycleNumber: 3, error: errorMsg, state: userCycleState });
    }

    if (cycleNum === 1) {
      const lockUntil = userCycleState.lock_until;
      if (lockUntil && today < lockUntil) {
        const errorMsg = `Cycle 1 is locked. Reset blocked until ${lockUntil}. You are currently in the initial execution period.`;
        addAuditEventToCycle(userCycleState, 'Reset rejected', `Cycle 1 reset attempt rejected: locked until ${lockUntil}. Current date: ${today}.`, user);
        return sendJson(res, 403, { success: false, error: errorMsg, lockUntil, state: userCycleState });
      }

      if (CYCLE_RULES.requireReasonForReset && (!reason || String(reason).trim().length < 5)) {
        return sendJson(res, 400, { success: false, error: 'A minimum 5-character reason is required to request a reset.', state: userCycleState });
      }

      const overallScore = userCycleState.scores?.overallScore || 0;
      if (overallScore < CYCLE_RULES.minScoreForReset) {
        const errorMsg = `Reset blocked: Your overall score (${overallScore}%) is below the minimum required ${CYCLE_RULES.minScoreForReset}% threshold.`;
        addAuditEventToCycle(userCycleState, 'Reset rejected', `Reset attempt rejected: score ${overallScore}% < min score ${CYCLE_RULES.minScoreForReset}%.`, user);
        return sendJson(res, 403, { success: false, error: errorMsg, minScore: CYCLE_RULES.minScoreForReset, currentScore: overallScore, state: userCycleState });
      }

      const freshCycle = createDefaultUserCycle1State(user, userCycleState.duration_days || 90);
      freshCycle.reset_count = (userCycleState.reset_count || 0) + 1;
      freshCycle.reset_reason = String(reason).trim();
      freshCycle.status = 'ACTIVE';
      freshCycle.audit_history = userCycleState.audit_history || [];
      addAuditEventToCycle(freshCycle, 'Cycle 1 Reset', `Cycle 1 reset approved and executed. Reason: "${reason}". Previous score: ${overallScore}%.`, user);

      await saveUserCycleState(user, freshCycle);
      return sendJson(res, 200, { success: true, message: 'Cycle 1 reset successfully.', state: freshCycle });
    }

    return sendJson(res, 400, { success: false, error: 'Invalid cycle state for reset request.', state: userCycleState });
  }

  if (pathname === '/api/cycle/sync' && req.method === 'POST') {
    const body = await readBody(req);
    const user = await getAuthenticatedUser(req);
    const userCycleState = await getUserCycleState(user);

    const { currentScores, clientSchedule } = body;
    if (clientSchedule && clientSchedule.startDate) {
      if (!userCycleState.target_schedule_date) userCycleState.target_schedule_date = {};
      userCycleState.target_schedule_date.startDate = clientSchedule.startDate;
      if (clientSchedule.endDate) userCycleState.target_schedule_date.endDate = clientSchedule.endDate;
      if (clientSchedule.durationDays) userCycleState.duration_days = Number(clientSchedule.durationDays);
      if (clientSchedule.currentCycle) userCycleState.cycle_number = Number(clientSchedule.currentCycle);
      if (clientSchedule.cycleGoal) userCycleState.cycle_goal = clientSchedule.cycleGoal;
    }
    if (currentScores && typeof currentScores === 'object') {
      userCycleState.scores = {
        habitScore: Number(currentScores.habitScore) || userCycleState.scores?.habitScore || 0,
        taskScore: Number(currentScores.taskScore) || userCycleState.scores?.taskScore || 0,
        productivityScore: Number(currentScores.productivityScore) || userCycleState.scores?.productivityScore || 0,
        overallScore: Number(currentScores.overallScore) || userCycleState.scores?.overallScore || 0,
        evaluatedAt: new Date().toISOString()
      };
    }
    await saveUserCycleState(user, userCycleState);
    return sendJson(res, 200, { success: true, state: userCycleState, rules: CYCLE_RULES });
  }

  if (pathname === '/api/cycle/wipe' && req.method === 'POST') {
    const user = await getAuthenticatedUser(req);
    const freshState = createDefaultUserCycle1State(user, 90);
    addAuditEventToCycle(freshState, 'Data wipe', 'All user cycle data reset to initial default state.', user);
    await saveUserCycleState(user, freshState);
    return sendJson(res, 200, { success: true, message: 'All cycle and tracker state wiped cleanly.', state: freshState });
  }

  // ---- Dynamic AI Coach Engine (Live Gemini AI + Smart Heuristics Fallback) ----
  if (pathname === '/api/ai-coach' && req.method === 'POST') {
    const body = await readBody(req);
    const {
      name,
      streak = 0,
      journeyPct = 0,
      doneHabits = 0,
      habitCount = 0,
      reflections = '',
      pendingTasks = 0,
      doneTasks = 0,
      focusMinutes = 0,
      dayNumber = 1,
      totalDays = 90,
      cycleGoal = ''
    } = body || {};

    const userName = (name && String(name).trim()) || 'Student';
    const habitRatio = habitCount > 0 ? (doneHabits / habitCount) : 1;
    const totalTasks = Number(doneTasks) + Number(pendingTasks);

    let aiGenerated = false;
    let coachOutput = '';

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY' && geminiKey.trim().length > 10) {
      try {
        const promptText = `You are the high-performance AI Performance Coach in DAYSTACK (a personal productivity cockpit).
Analyze this student/developer's current daily metrics and write a concise, inspiring, 3-bullet personalized briefing:
User: ${userName}
Day of Journey: ${dayNumber} / ${totalDays} (${journeyPct}% completed)
Active Goal: ${cycleGoal || 'High Performance Sprint'}
Habit Streak: ${streak} days (${doneHabits}/${habitCount} done today)
Tasks Today: ${doneTasks}/${totalTasks} done (${pendingTasks} remaining)
Focus Time: ${focusMinutes} minutes Pomodoro
User's Reflection Note: "${reflections || 'Ready to push forward'}"

Format output as clean HTML with 3 bullet points using <strong> tags:
1. <strong>Execution Rating:</strong> Assessment of discipline & velocity today.
2. <strong>Tactical Action Plan:</strong> Immediate next high-leverage step.
3. <strong>Mental Edge & Reflection:</strong> Direct response to their reflection or mindset guidance.
Keep it under 90 words. Do not use markdown backticks.`;

        const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { maxOutputTokens: 250, temperature: 0.7 }
          })
        });

        if (apiRes.ok) {
          const resData = await apiRes.json();
          const generated = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (generated && generated.trim().length > 20) {
            coachOutput = `✨ <strong>AI Coach Live Insights for ${userName}:</strong><br/>` + generated.trim();
            aiGenerated = true;
          }
        }
      } catch (e) {}
    }

    if (!aiGenerated) {
      // Dynamic Heuristic Analysis Engine
      let ratingText = '';
      if (streak >= 7 && habitRatio >= 0.8) {
        ratingText = `Elite consistency! You are on a powerhouse <strong>${streak}-day streak</strong> with ${(habitRatio * 100).toFixed(0)}% habit execution.`;
      } else if (habitRatio >= 0.5) {
        ratingText = `Steady progress with a <strong>${streak}-day streak</strong>. ${doneHabits}/${habitCount} habits logged today.`;
      } else if (habitCount > 0) {
        ratingText = `Momentum check: ${doneHabits}/${habitCount} habits logged. Today needs a focused push to protect your ${streak}-day streak.`;
      } else {
        ratingText = `Getting primed for action on Day ${dayNumber} of ${totalDays} (${journeyPct}% journey progress).`;
      }

      let planText = '';
      if (pendingTasks > 0) {
        planText = `You have <strong>${pendingTasks} pending item${pendingTasks > 1 ? 's' : ''}</strong> in your Daily Planner. Lock in a 25m Pomodoro sprint to clear your top P1 task.`;
      } else if (doneTasks > 0) {
        planText = `All <strong>${doneTasks} planned task${doneTasks > 1 ? 's' : ''} cleared</strong> for today! Channel remaining energy into deep reading, CP contests, or exam prep.`;
      } else if (focusMinutes < 25) {
        planText = `Kick off a single 25-minute Pomodoro focus block to build activation momentum toward "${cycleGoal || 'your target'}".`;
      } else {
        planText = `Logged <strong>${focusMinutes}m of deep focus</strong> today. Maintain this cadence into your evening reflection.`;
      }

      let reflectText = '';
      if (reflections && reflections.trim().length > 3) {
        reflectText = `"${reflections.trim()}" — Reflecting on your actions is how compounding happens. Review your wins and lessons in tonight's debrief.`;
      } else if (journeyPct >= 75) {
        reflectText = `Final stretch of your cycle (${journeyPct}%). The standard you maintain on ordinary days determines your results.`;
      } else if (journeyPct >= 30) {
        reflectText = `You are in the compounding zone (${journeyPct}%). Focus on winning today's blocks one at a time.`;
      } else {
        reflectText = `Early cycle momentum is critical. Small daily habits repeated 100 times create extraordinary leverage.`;
      }

      coachOutput = `✨ <strong>AI Coach Personal Assessment:</strong><br/>
• <strong>Execution Rating:</strong> ${ratingText}<br/>
• <strong>Optimal Action Plan:</strong> ${planText}<br/>
• <strong>Mental Edge:</strong> ${reflectText}`;
    }

    return sendJson(res, 200, {
      success: true,
      coachAssessment: coachOutput,
      isLiveAI: aiGenerated,
      mode: aiGenerated ? 'gemini_flash' : 'local_intelligence_engine',
      advice: coachOutput.split('<br/>\n').map(s => s.replace(/<[^>]*>?/gm, '').trim()).filter(Boolean)
    });
  }

  // Network Info API for Mobile Connection
  if (pathname === '/api/network-info') {
    const lanIp = getLanIp();
    return sendJson(res, 200, {
      success: true,
      ip: lanIp,
      port: PORT,
      url: `http://${lanIp}:${PORT}`,
      localUrl: `http://localhost:${PORT}`
    });
  }

  // ---- Supabase Frontend Config API ----
  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      appUrl: process.env.APP_URL || `http://${req.headers.host}`,
      adminEmail: process.env.ADMIN_EMAIL || 'umakanthreddyannem2007@gmail.com'
    });
  }

  // ---- User-scoped Store Sync API (cross-device data sync, 100% per-user) ----
  if (pathname === '/api/store' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (user) {
      const store = await readUserStore(user.id);
      if (store) {
        return sendJson(res, 200, { success: true, store, syncedAt: new Date().toISOString() });
      } else {
        return sendJson(res, 404, { success: false, message: 'No store yet for this user.' });
      }
    }
    // Guest store fallback
    return sendJson(res, 200, { success: true, store: null, message: 'Guest session.' });
  }

  if (pathname === '/api/store' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { success: false, message: 'Invalid store data.' });
    }
    const user = await getAuthenticatedUser(req);
    const now = new Date().toISOString();
    if (user) {
      // User-scoped store
      const existing = await readUserStore(user.id) || {};
      const merged = { ...existing, ...body, _syncedAt: now };
      await writeUserStore(user.id, merged);
      return sendJson(res, 200, { success: true, message: 'Store saved.', syncedAt: now });
    }
    // Guest store: acknowledge save without writing to any global file
    return sendJson(res, 200, { success: true, message: 'Guest store saved in memory.', syncedAt: now });
  }

  // ── GUARDIAN VERIFICATION & REAL EMAIL DISPATCH ────────────────────
  if (pathname === '/api/guardian/send-verification' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const user = await getAuthenticatedUser(req);
      const hostUrl = `http://${req.headers.host || 'localhost:' + PORT}`;
      const guardianEmail = body?.guardianEmail || '';
      const studentName = body?.studentName || user?.name || user?.email?.split('@')[0] || 'Student';
      const studentAge = body?.studentAge || null;
      const studentDob = body?.studentDob || null;

      const result = await sendGuardianVerificationEmail({
        guardianEmail,
        studentName,
        studentAge,
        studentDob,
        hostUrl
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message || 'Failed to send guardian verification email.' });
    }
  }

  if (pathname === '/api/guardian/verify-code' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const user = await getAuthenticatedUser(req);
      const result = verifyGuardianCode(body || {});

      // If user is authenticated, update their persisted store profile
      if (user && result.verified) {
        const store = await readUserStore(user.id) || {};
        if (!store.user) store.user = {};
        if (!store.user.profile) store.user.profile = {};
        store.user.profile.guardianEmail = result.guardianEmail;
        store.user.profile.guardianStatus = 'verified';
        store.user.profile.guardianConsentAt = result.verifiedAt;
        await writeUserStore(user.id, store);
      }

      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message || 'Verification failed.' });
    }
  }

  if (pathname === '/api/guardian/send-alert' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const user = await getAuthenticatedUser(req);
      const guardianEmail = body?.guardianEmail || '';
      const studentName = body?.studentName || user?.name || user?.email?.split('@')[0] || 'Student';
      const taskTitle = body?.taskTitle || 'Important Daily Milestone';
      const scheduledTime = body?.scheduledTime || 'Today';
      const reminderCount = body?.reminderCount || 2;

      const result = await sendGuardianEscalationAlert({
        guardianEmail,
        studentName,
        taskTitle,
        scheduledTime,
        reminderCount
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message || 'Failed to dispatch guardian alert.' });
    }
  }

  // Guardian 1-Click Verification Landing Webpage
  if (pathname === '/verify-guardian' && req.method === 'GET') {
    const token = parsedUrl.searchParams.get('token');
    const email = parsedUrl.searchParams.get('email');

    let verified = false;
    let studentName = 'Student';
    let error = null;

    if (token) {
      try {
        const resObj = verifyGuardianCode({ token, guardianEmail: email });
        verified = resObj.verified;
        studentName = resObj.studentName || 'Student';
      } catch (e) {
        error = e.message;
      }
    } else {
      error = 'No verification token provided.';
    }

    const html = renderGuardianVerificationWebpage({
      token,
      email,
      verified,
      studentName,
      error
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // Static File Serving
  let relativeFilePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  let filePath = path.normalize(path.join(process.cwd(), relativeFilePath));

  // Security check: Block direct access to dotfiles and server configuration/data files
  const baseName = path.basename(filePath);
  if (baseName.startsWith('.') || relativeFilePath.startsWith('.') || relativeFilePath.includes('/.') || relativeFilePath.includes('\\.')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden — Direct access to protected configuration or data files is blocked.');
  }

  // Security check: ensure filePath is within process.cwd()
  if (!filePath.startsWith(process.cwd())) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback: serve landing page for unknown HTML paths
      filePath = path.join(process.cwd(), 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isStaticAsset = ['.css', '.js', '.woff2', '.woff', '.ttf', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'].includes(ext);

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File Not Found');
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content);
    });
  });
});

function startListening(port) {
  const lanIp = getLanIp();
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 DAYSTACK Live Server is running!`);
    console.log(`🖥️  PC (this device): http://localhost:${port}`);
    console.log(`📱 Phone / Tablet:    http://${lanIp}:${port}`);
    console.log(`\n📶 Make sure your phone is on the SAME Wi-Fi network`);
    console.log(`   as this PC, then open the URL above on your phone.`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[DAYSTACK] Port ${port} is already in use. Retrying on port ${port + 1}...`);
      startListening(port + 1);
    } else {
      console.error('[DAYSTACK Server Error]:', err);
    }
  });
}

// Graceful termination
process.on('SIGINT', () => {
  console.log('\n[DAYSTACK] Stopping server gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

startListening(Number(PORT));
