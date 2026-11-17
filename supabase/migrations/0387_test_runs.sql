-- Test runs of the booking funnel: a link with ?test=1 lets somebody go
-- through booking, the map and the estimate as a client would, with nothing
-- charged and nobody's calendar booked. Their job is marked so it can be
-- listed on its own page and kept out of the sales numbers.

alter table public.jobs
  add column if not exists is_test boolean not null default false;

create index if not exists jobs_is_test_idx on public.jobs (property_id) where is_test;

-- The evaluation time a tester picked. Never put on the job, so no
-- evaluator's day is taken and no confirmation goes out.
alter table public.job_estimates
  add column if not exists test_visit_at timestamptz;
