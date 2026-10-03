-- A second job at the same address for the same person is usually a copy,
-- and sometimes more work. When a person says it is more work, that is
-- remembered on the job, and the board stops calling it a duplicate.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS duplicate_cleared_at TIMESTAMPTZ;
