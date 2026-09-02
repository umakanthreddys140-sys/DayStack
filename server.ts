import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "5mb" }));

/* --------------------------------------------------------------------------
   CONFIGURABLE CYCLE RULES & STATE MACHINE
   -------------------------------------------------------------------------- */
export const CYCLE_RULES = {
  minScoreForReset: 85,          // 85% required score threshold for Cycle 1 reset
  cycle1LockPeriodDays: 30,      // 1 month initial lock period for Cycle 1
  maxCycles: 3,
  requireReasonForReset: true,
  defaultCycleDurationDays: 90
};

export type CycleStatus =
  | 'DRAFT'
  | 'AWAITING_CONFIRMATION'
  | 'ACTIVE'
  | 'LOCKED'
  | 'COMPLETED'
  | 'ELIGIBLE_FOR_NEXT_CYCLE';

export interface CycleAuditEvent {
  id: string;
  timestamp: string;
  action: string;
  cycleNumber: number;
  status: CycleStatus;
  userId: string;
  details: string;
  reason?: string;
  scores?: any;
}

export interface CycleState {
  cycle_number: number;
  status: CycleStatus;
  target_schedule_date: {
    startDate: string;
    endDate: string;
  };
  cycle_goal: string;
  started_at: string | null;
  confirmed_at: string | null;
  started_by: string;
  lock_until: string | null;
  completed_at: string | null;
  duration_days?: number;
  reset_allowed: boolean;
  reset_reason: string | null;
  reset_requested_at: string | null;
  reset_count: number;
  scores: {
    habitScore: number;
    taskScore: number;
    productivityScore: number;
    overallScore: number;
    evaluatedAt?: string;
  };
  audit_history: CycleAuditEvent[];
}

const CYCLE_STATE_FILE = path.join(process.cwd(), '.cycle_state.json');

function getDefaultCycleState(): CycleState {
  const start = new Date().toISOString().slice(0, 10);
  const end = addDaysStr(start, 89);
  const lockUntil = addDaysStr(start, 29);

  return {
    cycle_number: 1,
    status: 'ACTIVE',
    target_schedule_date: {
      startDate: start,
      endDate: end
    },
    cycle_goal: 'Complete 90-day Productivity Target Journey',
    started_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    started_by: 'User',
    lock_until: lockUntil,
    completed_at: null,
    reset_allowed: false,
    reset_reason: null,
    reset_requested_at: null,
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
        id: 'aud_init_1',
        timestamp: new Date().toISOString(),
        action: 'Cycle started',
        cycleNumber: 1,
        status: 'ACTIVE',
        userId: 'User',
        details: `Cycle 1 initialized with target date ${start} → ${end}.`
      }
    ]
  };
}

let currentCycleState: CycleState = (() => {
  try {
    if (fs.existsSync(CYCLE_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CYCLE_STATE_FILE, 'utf-8'));
      if (data && typeof data.cycle_number === 'number') {
        return data;
      }
    }
  } catch (err) {
    console.error('Error reading cycle state file:', err);
  }
  const defaultState = getDefaultCycleState();
  try {
    fs.writeFileSync(CYCLE_STATE_FILE, JSON.stringify(defaultState, null, 2), 'utf-8');
  } catch (_) {}
  return defaultState;
})();

function persistCycleState() {
  try {
    fs.writeFileSync(CYCLE_STATE_FILE, JSON.stringify(currentCycleState, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save cycle state file:', err);
  }
}

function addAuditEvent(action: string, details: string, extra: Partial<CycleAuditEvent> = {}) {
  const evt: CycleAuditEvent = {
    id: 'aud_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    action,
    cycleNumber: currentCycleState.cycle_number,
    status: currentCycleState.status,
    userId: currentCycleState.started_by || 'User',
    details,
    ...extra
  };
  currentCycleState.audit_history.unshift(evt);
  // Keep up to 200 audit entries
  if (currentCycleState.audit_history.length > 200) {
    currentCycleState.audit_history = currentCycleState.audit_history.slice(0, 200);
  }
  persistCycleState();
  return evt;
}

// Date helper for server side
function addDaysStr(dateStr: string, days: number): string {
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  } catch {
    return dateStr;
  }
}

function diffDaysStr(d1: string, d2: string): number {
  try {
    const t1 = new Date(d1 + 'T00:00:00Z').getTime();
    const t2 = new Date(d2 + 'T00:00:00Z').getTime();
    return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

// Initialize Gemini Client lazily
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/* --------------------------------------------------------------------------
   SERVER-ENFORCED CYCLE WORKFLOW & LOCK ENDPOINTS
   -------------------------------------------------------------------------- */

// 1. Get Current Cycle State & Server Configuration Rules
app.get("/api/cycle/state", (req, res) => {
  res.json({
    success: true,
    rules: CYCLE_RULES,
    state: currentCycleState
  });
});

app.get("/api/cycle/rules", (req, res) => {
  res.json({
    success: true,
    rules: CYCLE_RULES
  });
});

// 2. Start / Confirm Cycle Workflow (Cycle 1, Cycle 2, or Cycle 3)
app.post("/api/cycle/confirm", (req, res) => {
  const { cycleNumber, startDate, endDate, cycleGoal, userName } = req.body || {};

  const targetCycle = Number(cycleNumber) || currentCycleState.cycle_number || 1;
  const user = (userName && String(userName).trim()) || currentCycleState.started_by || 'User';
  const start = startDate || currentCycleState.target_schedule_date.startDate;
  const end = endDate || currentCycleState.target_schedule_date.endDate;
  const goal = (cycleGoal && String(cycleGoal).trim()) || currentCycleState.cycle_goal;

  if (targetCycle > CYCLE_RULES.maxCycles) {
    return res.status(400).json({
      success: false,
      error: `Maximum cycle limit (${CYCLE_RULES.maxCycles}) reached.`
    });
  }

  // Calculate lock_until based on cycle number:
  // Cycle 1: start_date + 30 days (1 month)
  // Cycle 2: strictly locked until end_date (completion)
  // Cycle 3: strictly locked until end_date (completion)
  let lockUntil: string;
  if (targetCycle === 1) {
    lockUntil = addDaysStr(start, CYCLE_RULES.cycle1LockPeriodDays);
  } else {
    lockUntil = end; // Locked until full cycle completion
  }

  const now = new Date().toISOString();
  currentCycleState.cycle_number = targetCycle;
  currentCycleState.status = 'LOCKED';
  currentCycleState.target_schedule_date = { startDate: start, endDate: end };
  currentCycleState.cycle_goal = goal;
  currentCycleState.started_at = now;
  currentCycleState.confirmed_at = now;
  currentCycleState.started_by = user;
  currentCycleState.lock_until = lockUntil;
  currentCycleState.completed_at = null;
  currentCycleState.reset_allowed = false;
  currentCycleState.reset_reason = null;
  currentCycleState.reset_requested_at = null;

  const startAction = targetCycle === 1 ? 'Cycle started' : (targetCycle === 2 ? 'Cycle 2 started' : 'Cycle 3 started');
  addAuditEvent(startAction, `Started Cycle ${targetCycle} with target range ${start} → ${end}. Goal: "${goal}".`, { userId: user });
  addAuditEvent('Schedule confirmed', `Target schedule date ${start} → ${end} confirmed and locked under cycle rules.`, { userId: user });
  addAuditEvent('Schedule locked', `Schedule locked. Lock active until ${lockUntil}.`, { userId: user });

  persistCycleState();

  res.json({
    success: true,
    message: `Cycle ${targetCycle} confirmed and locked successfully.`,
    state: currentCycleState
  });
});

// 3. Server-Enforced Schedule Update
app.post("/api/cycle/update-schedule", (req, res) => {
  const { startDate, endDate, cycleGoal, durationDays } = req.body || {};
  const user = (req.headers['x-user-id'] as string) || 'User';

  const start = startDate || currentCycleState.target_schedule_date?.startDate || new Date().toISOString().slice(0, 10);
  const end = endDate || currentCycleState.target_schedule_date?.endDate || addDaysStr(start, (Number(durationDays) || 90) - 1);
  const dur = Math.max(1, diffDaysStr(start, end) + 1);
  const goal = (cycleGoal && String(cycleGoal).trim()) || currentCycleState.cycle_goal || `Complete ${dur}-day Productivity Target Journey`;

  const cycleNum = currentCycleState.cycle_number || 1;
  let lockUntil: string;
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

  currentCycleState.target_schedule_date.startDate = start;
  currentCycleState.target_schedule_date.endDate = end;
  currentCycleState.cycle_goal = goal;
  currentCycleState.lock_until = lockUntil;

  addAuditEvent('Schedule updated', `Target schedule updated: ${start} → ${end} (${dur} days). Goal: "${goal}".`, { userId: user });
  persistCycleState();

  res.json({
    success: true,
    message: 'Schedule updated successfully.',
    state: currentCycleState
  });
});

// 4. Server-Enforced Cycle Reset Request Workflow
// Evaluates cycle-specific rules, lock period, score threshold (>= 85%), and mandatory reason
app.post("/api/cycle/reset-request", (req, res) => {
  const { reason, currentScores, clientToday } = req.body || {};
  const cycleNum = currentCycleState.cycle_number;
  const today = clientToday || new Date().toISOString().slice(0, 10);

  // Update scores snapshot if provided
  if (currentScores && typeof currentScores === 'object') {
    currentCycleState.scores = {
      habitScore: Number(currentScores.habitScore) || 0,
      taskScore: Number(currentScores.taskScore) || 0,
      productivityScore: Number(currentScores.productivityScore) || 0,
      overallScore: Number(currentScores.overallScore) || 0,
      evaluatedAt: new Date().toISOString()
    };
  }

  // --- RULE FOR CYCLE 2 ---
  if (cycleNum === 2) {
    const errorMsg = 'Cycle 2 Cannot Be Reset. Cycle 2 has already started and cannot be reset at this time. The system is designed to prevent repeated cycle restarts and schedule manipulation. Please continue Cycle 2 until its completion requirements are met.';
    addAuditEvent('Reset rejected', `Cycle 2 reset attempt rejected: Cycle 2 cannot be reset once started.`, {
      reason: reason || 'None provided'
    });
    return res.status(403).json({
      success: false,
      cycleNumber: 2,
      error: errorMsg,
      state: currentCycleState
    });
  }

  // --- RULE FOR CYCLE 3 ---
  if (cycleNum >= 3) {
    // Only allow after Cycle 3 is completed
    if (currentCycleState.status !== 'COMPLETED') {
      const errorMsg = 'Cycle 3 Cannot Be Reset. Cycle 3 is strictly locked until full completion. No resetting or restarting Cycle 3 is permitted.';
      addAuditEvent('Reset rejected', `Cycle 3 reset attempt rejected: Strictly locked until completion.`);
      return res.status(403).json({
        success: false,
        cycleNumber: 3,
        error: errorMsg,
        state: currentCycleState
      });
    }
  }

  // --- RULE FOR CYCLE 1 ---
  if (cycleNum === 1) {
    // 1. Check lock period: cycle_start_date + 1 month
    const lockUntil = currentCycleState.lock_until || addDaysStr(currentCycleState.target_schedule_date.startDate, CYCLE_RULES.cycle1LockPeriodDays);
    if (today < lockUntil) {
      const errorMsg = `Cycle 1 is currently in its initial 1-month lock period (active until ${lockUntil}). Schedule date, cycle-start information, and submitted data are locked, and Reset Cycle is disabled during this period.`;
      addAuditEvent('Reset rejected', `Cycle 1 reset attempt rejected: Lock period active until ${lockUntil}. (Current date: ${today}).`);
      return res.status(400).json({
        success: false,
        cycleNumber: 1,
        error: errorMsg,
        lockUntil: lockUntil,
        isLockPeriodActive: true,
        state: currentCycleState
      });
    }

    // 2. Evaluate scores: All required scores must be >= 85%
    const scoreVal = currentCycleState.scores.overallScore || 0;
    const habitScore = currentCycleState.scores.habitScore || 0;
    const taskScore = currentCycleState.scores.taskScore || 0;
    const minThreshold = CYCLE_RULES.minScoreForReset;

    if (scoreVal < minThreshold || habitScore < minThreshold) {
      const currentMinScore = Math.min(scoreVal, habitScore);
      const errorMsg = `Cycle Reset Not Available. A cycle reset is currently unavailable because all required scores must be at least ${minThreshold}%. Your current evaluation score is ${currentMinScore}%. Please continue the current cycle and complete the required progress before attempting another reset.`;
      addAuditEvent('Reset rejected', `Cycle 1 reset rejected: Score (${currentMinScore}%) does not meet the ${minThreshold}% threshold.`, {
        scores: currentCycleState.scores
      });
      return res.status(400).json({
        success: false,
        cycleNumber: 1,
        error: errorMsg,
        scoreRequired: minThreshold,
        scoreCurrent: currentMinScore,
        scoreBreakdown: currentCycleState.scores,
        isScoreBelowThreshold: true,
        state: currentCycleState
      });
    }

    // 3. Score meets 85%: Mandatory reason check
    const reasonStr = (reason && String(reason).trim()) || '';
    if (!reasonStr) {
      return res.status(400).json({
        success: false,
        error: 'A mandatory explanation reason is required to submit a cycle reset request.',
        requireReason: true
      });
    }

    // APPROVED RESET FOR CYCLE 1:
    currentCycleState.reset_count += 1;
    currentCycleState.reset_reason = reasonStr;
    currentCycleState.reset_requested_at = new Date().toISOString();
    currentCycleState.reset_allowed = true;
    currentCycleState.status = 'ELIGIBLE_FOR_NEXT_CYCLE';

    addAuditEvent('Reset approved', `Cycle 1 reset request approved. Score: ${scoreVal}% >= ${minThreshold}%.`, {
      reason: reasonStr,
      scores: currentCycleState.scores
    });
    addAuditEvent('Reset reason submitted', `Reset explanation recorded: "${reasonStr}"`, {
      reason: reasonStr
    });

    persistCycleState();

    return res.json({
      success: true,
      message: 'Cycle 1 reset request approved! You may now configure and start Cycle 2.',
      nextCycleNumber: 2,
      state: currentCycleState
    });
  }

  return res.status(400).json({
    success: false,
    error: 'Invalid cycle state for reset request.',
    state: currentCycleState
  });
});

// 5. Complete Cycle Endpoint
app.post("/api/cycle/complete", (req, res) => {
  const cycleNum = currentCycleState.cycle_number;
  const now = new Date().toISOString();

  currentCycleState.status = 'COMPLETED';
  currentCycleState.completed_at = now;
  currentCycleState.reset_allowed = false;

  addAuditEvent('Cycle completed', `Cycle ${cycleNum} completed successfully!`, {
    cycleNumber: cycleNum
  });

  persistCycleState();

  res.json({
    success: true,
    message: `Congratulations! Cycle ${cycleNum} has been successfully completed.`,
    state: currentCycleState
  });
});

// 6. Sync Cycle State between Client and Server
app.post("/api/cycle/sync", (req, res) => {
  const { clientState, currentScores, clientSchedule } = req.body || {};
  if (clientSchedule && clientSchedule.startDate) {
    if (!currentCycleState.target_schedule_date) currentCycleState.target_schedule_date = { startDate: clientSchedule.startDate, endDate: clientSchedule.endDate };
    currentCycleState.target_schedule_date.startDate = clientSchedule.startDate;
    if (clientSchedule.endDate) currentCycleState.target_schedule_date.endDate = clientSchedule.endDate;
    if (clientSchedule.durationDays) currentCycleState.duration_days = Number(clientSchedule.durationDays);
    if (clientSchedule.currentCycle) currentCycleState.cycle_number = Number(clientSchedule.currentCycle);
    if (clientSchedule.cycleGoal) currentCycleState.cycle_goal = clientSchedule.cycleGoal;
    persistCycleState();
  }
  if (currentScores && typeof currentScores === 'object') {
    currentCycleState.scores = {
      habitScore: Number(currentScores.habitScore) || currentCycleState.scores.habitScore,
      taskScore: Number(currentScores.taskScore) || currentCycleState.scores.taskScore,
      productivityScore: Number(currentScores.productivityScore) || currentCycleState.scores.productivityScore,
      overallScore: Number(currentScores.overallScore) || currentCycleState.scores.overallScore,
      evaluatedAt: new Date().toISOString()
    };
    persistCycleState();
  }
  res.json({
    success: true,
    state: currentCycleState,
    rules: CYCLE_RULES
  });
});

// 7. Reset / Wipe Cycle State on Server
app.post("/api/cycle/wipe", (req, res) => {
  currentCycleState = getDefaultCycleState();
  persistCycleState();
  res.json({
    success: true,
    message: 'Server cycle state reset to defaults.',
    state: currentCycleState
  });
});

// Real Gemini AI Performance Coach Endpoint
app.post("/api/ai-coach", async (req, res) => {
  try {
    const { name, streak, journeyPct, habitCount, doneHabits, todayTasks, studyHours, reflections, userPrompt } = req.body || {};

    const ai = getGeminiClient();

    if (!ai) {
      // Graceful fallback if GEMINI_API_KEY is not configured
      return res.json({
        coachAssessment: `✨ <strong>AI Coach Personal Assessment:</strong><br/>
• <strong>Execution Rating:</strong> Outstanding discipline with a ${streak || 0}-day habit streak and ${journeyPct || 0}% overall journey completion.<br/>
• <strong>Optimal Action Plan:</strong> Focus on completing high-priority items in your Daily Planner and maintaining your ${doneHabits || 0}/${habitCount || 0} habit completion momentum today.<br/>
• <strong>Reflection Note:</strong> "${reflections || 'Keep taking consistent action daily!'}"`
      });
    }

    const systemPrompt = `You are the elite AI Performance & Life Coach inside the DAYSTACK app.
Your user is ${name || 'Friend'}.
User Statistics:
- Current Habit Streak: ${streak || 0} days
- Overall Journey Completion: ${journeyPct || 0}%
- Habits Completed Today: ${doneHabits || 0} out of ${habitCount || 0}
- Tasks Status: ${todayTasks || 'Tasks in progress'}
- Study Hours Logged: ${studyHours || 0} hours
- Latest Journal/Reflection Note: "${reflections || 'No reflection logged yet'}"

Instructions:
Provide a concise, motivating, and deeply actionable 3-part personal assessment for the user.
Use clean HTML formatting with bold tags (<strong>), bullet points (•), and tasteful emojis.
Structure:
1. <strong>Execution & Momentum Analysis:</strong> Specific praise or observation based on their streak and habits.
2. <strong>Priority Focus & Action Plan:</strong> 1-2 sharp, practical recommendations for today's tasks and deep work.
3. <strong>Mindset & Reflection Feedback:</strong> Encouraging feedback tailored to their reflection note.
Keep the response under 180 words, crisp, sharp, and highly inspiring.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: userPrompt ? `User Question/Prompt: "${userPrompt}"\n\nAnalyze stats and answer:` : "Provide my daily performance assessment.",
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
      },
    });

    const coachAssessment = response.text || "✨ Keep building momentum step-by-step!";
    return res.json({ coachAssessment });
  } catch (err: any) {
    console.error("Gemini AI Coach Error:", err);
    return res.json({
      coachAssessment: `✨ <strong>AI Coach Assessment:</strong><br/>
• Keep up your habit streak! Focus on checking off high-priority tasks in your Daily Planner today.`
    });
  }
});

// Vite Middleware Integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
