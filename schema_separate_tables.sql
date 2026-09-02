-- ==============================================================================
-- DAYSTACK MULTI-TABLE DATABASE SCHEMA (SEPARATE TABLES PER SECTION)
-- ==============================================================================

-- 1. USER SETTINGS & TARGET CYCLE
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT DEFAULT 'Student',
  theme TEXT DEFAULT 'dark',
  accent TEXT DEFAULT 'blue',
  glass_fx TEXT DEFAULT 'ultra',
  schedule JSONB DEFAULT '{"currentCycle":1,"maxCycles":3,"durationDays":90,"cycleGoal":"Complete 90-day Productivity Journey","status":"ACTIVE"}'::jsonb,
  cycle_history JSONB DEFAULT '[]'::jsonb,
  active_modules TEXT[] DEFAULT ARRAY['planner','habits','pomodoro','calendar','contests','exams','college','study','projects','fitness','finance','journal','mistakes','goals'],
  about_cycle_doc_url TEXT DEFAULT 'https://docs.google.com/document/d/14H0fyrX7d7GDtxSUwecF4guQVvKPEnIGGgtR22IxEwM/edit?usp=sharing',
  onboarding JSONB DEFAULT '{"completed":false,"tourCompleted":false,"step":0,"sectionToursCompleted":{}}'::jsonb,
  pinned_sections JSONB DEFAULT '{}'::jsonb,
  expanded_sections JSONB DEFAULT '{}'::jsonb,
  notifications_config JSONB DEFAULT '{"enabled":true,"leadMinutes":5,"cooldownMinutes":15,"audioEnabled":true,"vibrationEnabled":true,"importantAlertsEnabled":true,"browserEnabled":false}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own settings" ON user_settings FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own settings" ON user_settings FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own settings" ON user_settings FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can delete own settings" ON user_settings FOR DELETE USING (auth.uid() = id);

-- 2. DAILY PLANNER DAYS
CREATE TABLE IF NOT EXISTS planner_days (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date TEXT NOT NULL,
  tasks JSONB DEFAULT '[]'::jsonb,
  checklist JSONB DEFAULT '[]'::jsonb,
  notes TEXT DEFAULT '',
  mood INTEGER,
  energy INTEGER,
  water NUMERIC DEFAULT 0,
  sleep_time TEXT,
  wake_time TEXT,
  reflection JSONB DEFAULT '{"wins":"","learned":"","improve":"","gratitude":""}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, date)
);
ALTER TABLE planner_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own planner days" ON planner_days FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own planner days" ON planner_days FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own planner days" ON planner_days FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own planner days" ON planner_days FOR DELETE USING (auth.uid() = user_id);

-- 3. HABITS
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'growth',
  frequency TEXT DEFAULT 'daily',
  target_days INTEGER DEFAULT 7,
  archived BOOLEAN DEFAULT false,
  reminder_time TEXT,
  stack_anchor TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own habits" ON habits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own habits" ON habits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own habits" ON habits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own habits" ON habits FOR DELETE USING (auth.uid() = user_id);

-- 4. HABIT LOGS
CREATE TABLE IF NOT EXISTS habit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, date, habit_id)
);
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own habit logs" ON habit_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own habit logs" ON habit_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own habit logs" ON habit_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own habit logs" ON habit_logs FOR DELETE USING (auth.uid() = user_id);

-- 5. POMODORO SESSIONS
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  minutes NUMERIC NOT NULL,
  task_id TEXT,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE pomodoro_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own pomodoro sessions" ON pomodoro_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pomodoro sessions" ON pomodoro_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pomodoro sessions" ON pomodoro_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pomodoro sessions" ON pomodoro_sessions FOR DELETE USING (auth.uid() = user_id);

-- 6. GOALS & MILESTONES
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  timeframe TEXT DEFAULT 'monthly',
  deadline TEXT,
  description TEXT,
  category TEXT DEFAULT 'life',
  target NUMERIC,
  unit TEXT,
  done BOOLEAN DEFAULT false,
  subtasks JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own goals" ON goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own goals" ON goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own goals" ON goals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own goals" ON goals FOR DELETE USING (auth.uid() = user_id);

-- 7. PROJECTS PORTFOLIO
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  tech TEXT,
  "desc" TEXT,
  status TEXT DEFAULT 'Active',
  github_url TEXT,
  live_url TEXT,
  milestones JSONB DEFAULT '[]'::jsonb,
  logs JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own projects" ON projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own projects" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own projects" ON projects FOR DELETE USING (auth.uid() = user_id);

-- 8. STUDY & CODING SESSIONS
CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT,
  date TEXT NOT NULL,
  hours NUMERIC DEFAULT 0 NOT NULL,
  problems INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own study sessions" ON study_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own study sessions" ON study_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own study sessions" ON study_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own study sessions" ON study_sessions FOR DELETE USING (auth.uid() = user_id);

-- 9. CONTESTS TRACKER
CREATE TABLE IF NOT EXISTS contests (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  duration TEXT,
  contest_url TEXT,
  registered BOOLEAN DEFAULT false,
  reminder_set BOOLEAN DEFAULT false,
  target_rank TEXT,
  actual_rank TEXT,
  problems_solved INTEGER DEFAULT 0,
  rating_change TEXT,
  notes TEXT,
  status TEXT DEFAULT 'upcoming',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE contests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own contests" ON contests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contests" ON contests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contests" ON contests FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contests" ON contests FOR DELETE USING (auth.uid() = user_id);

-- 10. EXAMS & ACADEMICS
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'Internal / CAT',
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  semester TEXT,
  notes TEXT,
  subjects JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own exams" ON exams FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own exams" ON exams FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own exams" ON exams FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own exams" ON exams FOR DELETE USING (auth.uid() = user_id);

-- 11. COLLEGE TIMETABLE & UPDATES
CREATE TABLE IF NOT EXISTS college_timetable (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  schedules JSONB DEFAULT '{}'::jsonb,
  updates JSONB DEFAULT '[]'::jsonb,
  default_classes JSONB DEFAULT '[]'::jsonb,
  semester_subjects JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id)
);
ALTER TABLE college_timetable ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own college timetable" ON college_timetable FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own college timetable" ON college_timetable FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own college timetable" ON college_timetable FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own college timetable" ON college_timetable FOR DELETE USING (auth.uid() = user_id);

-- 12. FITNESS & HEALTH VITALS
CREATE TABLE IF NOT EXISTS fitness_vitals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trackers JSONB DEFAULT '[]'::jsonb,
  goals JSONB DEFAULT '[]'::jsonb,
  vitals_logs JSONB DEFAULT '{}'::jsonb,
  health_logs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id)
);
ALTER TABLE fitness_vitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own fitness vitals" ON fitness_vitals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own fitness vitals" ON fitness_vitals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own fitness vitals" ON fitness_vitals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own fitness vitals" ON fitness_vitals FOR DELETE USING (auth.uid() = user_id);

-- 13. FINANCE & EXPENSES
CREATE TABLE IF NOT EXISTS finance_transactions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  method TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance transactions" ON finance_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own finance transactions" ON finance_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance transactions" ON finance_transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance transactions" ON finance_transactions FOR DELETE USING (auth.uid() = user_id);

-- 14. JOURNAL, READING & NOTES
CREATE TABLE IF NOT EXISTS journal_and_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  journal JSONB DEFAULT '[]'::jsonb,
  notes JSONB DEFAULT '[]'::jsonb,
  books JSONB DEFAULT '[]'::jsonb,
  mistakes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id)
);
ALTER TABLE journal_and_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own journal and notes" ON journal_and_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own journal and notes" ON journal_and_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own journal and notes" ON journal_and_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own journal and notes" ON journal_and_notes FOR DELETE USING (auth.uid() = user_id);

-- 15. FEEDBACK
CREATE TABLE IF NOT EXISTS feedback (
  id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  section text,
  smoothness text,
  worked_well text,
  difficulties text,
  review_text text not null,
  reviewed boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert feedback" ON feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can read own feedback" ON feedback FOR SELECT USING (auth.uid() = user_id);
-- No explicit Admin SELECT policy needed because admins use service_role key to query via the backend

