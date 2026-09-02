-- ============================================================================
-- DAYSTACK: Add user_name Column to All 15 Dedicated Section Tables
-- ============================================================================

-- 1. user_settings (add alias user_name text if desired, name already exists)
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS user_name text;

-- 2. planner_days
ALTER TABLE public.planner_days ADD COLUMN IF NOT EXISTS user_name text;

-- 3. habits
ALTER TABLE public.habits ADD COLUMN IF NOT EXISTS user_name text;

-- 4. habit_logs
ALTER TABLE public.habit_logs ADD COLUMN IF NOT EXISTS user_name text;

-- 5. pomodoro_sessions
ALTER TABLE public.pomodoro_sessions ADD COLUMN IF NOT EXISTS user_name text;

-- 6. goals
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS user_name text;

-- 7. projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS user_name text;

-- 8. study_sessions
ALTER TABLE public.study_sessions ADD COLUMN IF NOT EXISTS user_name text;

-- 9. contests
ALTER TABLE public.contests ADD COLUMN IF NOT EXISTS user_name text;

-- 10. exams
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS user_name text;

-- 11. college_timetable
ALTER TABLE public.college_timetable ADD COLUMN IF NOT EXISTS user_name text;

-- 12. fitness_vitals
ALTER TABLE public.fitness_vitals ADD COLUMN IF NOT EXISTS user_name text;

-- 13. finance_transactions
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS user_name text;

-- 14. journal_and_notes
ALTER TABLE public.journal_and_notes ADD COLUMN IF NOT EXISTS user_name text;

-- 15. feedback
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS user_name text;

-- Confirmation query to verify columns added
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM 
    information_schema.columns 
WHERE 
    table_schema = 'public' 
    AND column_name = 'user_name'
ORDER BY 
    table_name;
