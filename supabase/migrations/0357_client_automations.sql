-- Automated client messages, part two (workstream A2).
--
-- Invoice reminders that actually send, the Google review ask, longer
-- proposal follow-ups that stop on a reply, no-show rebooking, win-back,
-- renewals and the salt pre-sell, missed-call text-back and calls logged from
-- Twilio. Every message still goes through client_message_log; these tables
-- hold the switches, the things that need a person, and the records the
-- senders work from.
--
-- Additive only. Nothing here changes an existing row.

-- ---------------------------------------------------------------------------
-- 1. One switch per sequence, with the moment it was first switched on
-- ---------------------------------------------------------------------------
-- started_at is the go-live guard: a sequence only acts on records created or
-- changed after it, so switching one on never texts the backlog. It is set the
-- first time the switch goes on and never moved after that.
create table if not exists public.client_automation_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sequence text not null check (sequence in (
    'invoice_reminders',
    'review_requests',
    'proposal_follow_ups',
    'no_show_rebook',
    'win_back',
    'renewals',
    'salt_presell',
    'missed_call_text',
    'call_logging'
  )),
  enabled boolean not null default false,
  started_at timestamptz,
  -- Timings and words that belong to one sequence: the review link, the
  -- renewal escalator, the season start. Read through a typed merge in
  -- src/lib/client-automations/settings.ts, so a missing key is the default.
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (organization_id, sequence)
);
alter table public.client_automation_settings enable row level security;
drop policy if exists client_automation_settings_own_org on public.client_automation_settings;
create policy client_automation_settings_own_org on public.client_automation_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 2. The things these sequences hand to a person
-- ---------------------------------------------------------------------------
-- job_exceptions is the field's list (its kinds are crew problems and a crew
-- lead decides most of them), so an unpaid invoice or an unhappy rating has
-- its own short list here, read by the owner's Automated messages panel.
create table if not exists public.client_automation_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('collections', 'low_rating')),
  state text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  summary text not null check (length(btrim(summary)) > 0),
  detail text,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  -- The invoice, review request or call it is about.
  reference_id uuid,
  -- One exception per thing: a second run finds the first and stops.
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, dedupe_key)
);
create index if not exists client_automation_exceptions_open_idx
  on public.client_automation_exceptions (organization_id, state, created_at desc);
alter table public.client_automation_exceptions enable row level security;
drop policy if exists client_automation_exceptions_own_org on public.client_automation_exceptions;
create policy client_automation_exceptions_own_org on public.client_automation_exceptions
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 3. Review requests: one per job, with the rating that came back
-- ---------------------------------------------------------------------------
-- The token is the public /rate/<token> page. The page reads and writes this
-- row with the service key; the policy below is for the signed-in owner.
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- What set it off: the client approving the before and afters, or paying.
  trigger text not null check (trigger in ('signoff', 'paid')),
  triggered_at timestamptz not null,
  token text not null unique,
  rating smallint check (rating between 1 and 5),
  rated_at timestamptz,
  feedback text,
  -- When a five was sent on to Google. We cannot see the review itself, so
  -- this is the closest thing to "already reviewed" the app can know.
  sent_to_google_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, job_id)
);
create index if not exists review_requests_customer_idx on public.review_requests (customer_id, created_at desc);
alter table public.review_requests enable row level security;
drop policy if exists review_requests_own_org on public.review_requests;
create policy review_requests_own_org on public.review_requests
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 4. Calls, as Twilio reports them
-- ---------------------------------------------------------------------------
-- Written by the Dial action callback (api/webhooks/twilio-voice/dial-status)
-- for calls in and click-to-call calls out. An answered call about an open
-- proposal waits here for a one-tap disposition, which becomes a
-- proposal_calls row; an unanswered call out is logged as "no answer" straight
-- away; an unanswered call in is a missed call and gets the text-back.
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  call_sid text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text,
  to_number text,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  proposal_id uuid references public.job_proposals(id) on delete set null,
  -- The team member on our end: whoever pressed Call, or whoever answered.
  profile_id uuid references public.profiles(id) on delete set null,
  dial_status text not null,
  duration_seconds integer not null default 0,
  missed boolean not null default false,
  disposition text,
  disposition_at timestamptz,
  disposition_by uuid references public.profiles(id) on delete set null,
  proposal_call_id uuid references public.proposal_calls(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists voice_calls_org_idx on public.voice_calls (organization_id, created_at desc);
create index if not exists voice_calls_open_idx on public.voice_calls (organization_id)
  where disposition is null and proposal_id is not null and missed = false;
alter table public.voice_calls enable row level security;
drop policy if exists voice_calls_own_org on public.voice_calls;
create policy voice_calls_own_org on public.voice_calls
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 5. Owner-started campaigns: who pressed the button, and what it did
-- ---------------------------------------------------------------------------
create table if not exists public.client_campaign_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign text not null check (campaign in ('renewals', 'salt_presell')),
  -- The season it was for, e.g. "2027" or "2026-27": a campaign runs once a season.
  season text not null,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  audience integer not null default 0,
  sent integer not null default 0,
  skipped integer not null default 0,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists client_campaign_runs_org_idx on public.client_campaign_runs (organization_id, campaign, started_at desc);
alter table public.client_campaign_runs enable row level security;
drop policy if exists client_campaign_runs_own_org on public.client_campaign_runs;
create policy client_campaign_runs_own_org on public.client_campaign_runs
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
