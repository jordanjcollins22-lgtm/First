-- Social autopost: posts that go out by themselves, to Facebook and
-- Instagram, on a cadence, and say plainly when they can't.
--
-- 1. social_posts learns which accounts a post is for, what each account
--    answered, how many times it has been tried, why the last try failed and
--    when it will be tried next. 'failed' joins the statuses: a post Meta
--    keeps refusing stops at 'failed' with its reason instead of retrying for
--    ever or silently waiting.
-- 2. social_cadence: posts a week per account and the best-time slots the
--    scheduler fills from approved drafts (default 4 on Facebook and 4 on
--    Instagram), and the posting job's last run, for the status line on
--    Admin › Social.
-- 3. The database's timer calls /api/cron/social-posts at five past every
--    hour, with the token 0365_scheduler.sql already made, so a 6pm slot goes
--    out at 6pm instead of the next morning's Vercel run.
--
-- Safe to run twice.

-- 1. Posts --------------------------------------------------------------------

alter table public.social_posts add column if not exists platforms text[] not null default '{facebook,instagram}';
alter table public.social_posts add column if not exists results jsonb not null default '{}'::jsonb;
alter table public.social_posts add column if not exists attempts integer not null default 0;
alter table public.social_posts add column if not exists last_error text;
alter table public.social_posts add column if not exists last_attempt_at timestamptz;
alter table public.social_posts add column if not exists next_attempt_at timestamptz;
alter table public.social_posts add column if not exists photo_hint text;
alter table public.social_posts add column if not exists seed_key text;

alter table public.social_posts drop constraint if exists social_posts_status_check;
alter table public.social_posts add constraint social_posts_status_check
  check (status in ('draft', 'approved', 'scheduled', 'posted', 'skipped', 'failed'));

alter table public.social_posts drop constraint if exists social_posts_platforms_check;
alter table public.social_posts add constraint social_posts_platforms_check
  check (platforms <@ array['facebook', 'instagram']::text[]);

-- A starter draft loaded twice is still one draft.
create unique index if not exists social_posts_seed_key_idx
  on public.social_posts (organization_id, seed_key) where seed_key is not null;

create index if not exists social_posts_retry_idx
  on public.social_posts (next_attempt_at) where status = 'scheduled';

-- 2. Cadence ------------------------------------------------------------------

create table if not exists public.social_cadence (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  facebook_per_week integer not null default 4 check (facebook_per_week between 0 and 14),
  instagram_per_week integer not null default 4 check (instagram_per_week between 0 and 14),
  -- Best-time slots in priority order, on the business's clock:
  -- [{"weekday": 0-6 (0 = Sunday), "hour": 0-23}].
  slots jsonb not null default '[
    {"weekday": 2, "hour": 10},
    {"weekday": 4, "hour": 18},
    {"weekday": 6, "hour": 9},
    {"weekday": 0, "hour": 17},
    {"weekday": 3, "hour": 12},
    {"weekday": 5, "hour": 12}
  ]'::jsonb,
  -- Give approved posts with no time the next free slot.
  autofill boolean not null default true,
  last_run_at timestamptz,
  last_run jsonb,
  last_success_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.social_cadence enable row level security;

drop policy if exists social_cadence_own_org on public.social_cadence;
create policy social_cadence_own_org on public.social_cadence
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- 3. Hourly posting run ---------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron is not installed; social posts keep the daily Vercel run.';
    return;
  end if;
  -- The token 0365 made lives only in cron.job, so it is read from there.
  select substring(command from 'x-scheduler-token'', ''([0-9a-f]+)''')
    into t
    from cron.job
   where jobname like 'sched-%'
     and command like '%x-scheduler-token%'
   limit 1;
  if t is null then
    raise notice 'No scheduler token yet (run 0365_scheduler.sql first); social posts keep the daily Vercel run.';
    return;
  end if;
  perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'sched-social-posts';
  perform cron.schedule(
    'sched-social-posts',
    '5 * * * *',
    format(
      $cmd$select net.http_get(url := %L, headers := jsonb_build_object('x-scheduler-token', %L), timeout_milliseconds := 55000)$cmd$,
      'https://app.jslandscapingmd.com/api/cron/social-posts', t
    )
  );
end $$;

notify pgrst, 'reload schema';
