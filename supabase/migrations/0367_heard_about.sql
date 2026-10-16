-- "How did you hear about us?", asked when a visit is booked (online or by
-- the office on the phone) and kept on the job, so Marketing can count which
-- channel brings in visits and signed work. Nullable: older jobs, and anybody
-- who skips the question, simply have no answer.
alter table public.jobs add column if not exists heard_about text
  check (heard_about in ('google', 'facebook', 'nextdoor', 'friend', 'yard_sign', 'door_hanger', 'truck', 'returning', 'other'));
alter table public.jobs add column if not exists heard_about_detail text;

create index if not exists jobs_heard_about_idx on public.jobs (heard_about) where heard_about is not null;
