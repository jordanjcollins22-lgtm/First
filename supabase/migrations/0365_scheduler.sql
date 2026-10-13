-- The database's own timer for the time-sensitive automations.
--
-- Vercel's crons run once a day on this plan. pg_cron calls these routes
-- every few minutes instead, with a token made here, at random, inside the
-- database. Only the token's SHA-256 is kept in scheduler_tokens (no
-- policies: service role only); the token itself lives only in cron.job, so
-- it never has to be copied anywhere. The routes check it in
-- authorizeScheduledCall (src/lib/cron-auth.ts).
--
-- Running this again replaces the token and the jobs, so it is safe to re-run.

create table if not exists public.scheduler_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.scheduler_tokens enable row level security;

do $$
declare
  t text := encode(extensions.gen_random_bytes(32), 'hex');
  base text := 'https://app.jslandscapingmd.com/api/cron/';
  job record;
begin
  delete from public.scheduler_tokens;
  insert into public.scheduler_tokens (token_hash) values (encode(extensions.digest(t, 'sha256'), 'hex'));

  for job in
    select * from (values
      -- Every 15 minutes: things that must not wait a day.
      ('sched-approvals-sweep',     '*/15 * * * *',   'approvals-sweep'),
      ('sched-client-automations',  '*/15 * * * *',   'client-automations'),
      ('sched-client-reminders',    '*/15 * * * *',   'client-reminders'),
      ('sched-evaluation-emails',   '*/15 * * * *',   'evaluation-emails'),
      ('sched-ops-loops',           '*/15 * * * *',   'ops-loops'),
      ('sched-proposal-autopilot',  '*/15 * * * *',   'proposal-autopilot'),
      ('sched-marketing-autopilot', '*/15 * * * *',   'marketing-autopilot'),
      ('sched-purchasing',          '7,37 * * * *',   'purchasing'),
      ('sched-equipment',           '*/15 * * * *',   'equipment'),
      -- Crew check-in: 8:30 to 12:30 Eastern, Monday to Saturday (both offsets).
      ('sched-crew-checkin',        '*/15 12-17 * * 1-6', 'crew-checkin'),
      -- Hourly.
      ('sched-ops-auto-place',      '20 11-23 * * *', 'ops-auto-place'),
      ('sched-qbo-sync',            '40 * * * *',     'qbo-sync'),
      ('sched-finance-autopay',     '50 * * * *',     'finance-autopay'),
      -- Every 3 hours.
      ('sched-weather-cascade',     '10 */3 * * *',   'weather-cascade'),
      -- Daily and weekly.
      ('sched-google-daily',        '5 13 * * *',     'google-daily'),
      ('sched-commission-accrual',  '15 10 * * *',    'commission-accrual'),
      ('sched-back-office',         '25 11 * * *',    'back-office'),
      ('sched-crew-bonus',          '35 10 * * 1',    'crew-bonus'),
      ('sched-owner-digest',        '0 11,12 * * 1',  'owner-digest'),
      ('sched-rank-check',          '45 14 * * 2',    'rank-check')
    ) as v(name, schedule, route)
  loop
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = job.name;
    perform cron.schedule(
      job.name,
      job.schedule,
      format(
        $cmd$select net.http_get(url := %L, headers := jsonb_build_object('x-scheduler-token', %L), timeout_milliseconds := 55000)$cmd$,
        base || job.route, t
      )
    );
  end loop;
end $$;
