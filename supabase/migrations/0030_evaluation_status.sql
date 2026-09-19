-- Tracks the evaluator's progress on a scheduled evaluation appointment,
-- separate from the job's overall pipeline status (estimating/quoted/etc).
alter table jobs add column if not exists evaluation_status text not null default 'scheduled'
  check (evaluation_status in ('scheduled', 'on_way', 'arrived', 'completed'));
