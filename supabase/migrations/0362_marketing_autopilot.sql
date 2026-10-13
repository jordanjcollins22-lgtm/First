-- Marketing that runs itself: plays that close, Google connected, spend
-- imported, and the numbers to say what each channel costs.
--
-- Everything here is additive. Nothing existing is rewritten, and no row the
-- business already has is touched: every automation that reads these tables
-- keeps its own on/off switch and the moment it was first switched on
-- (marketing_autopilot_settings.started), and acts only on what was made or
-- changed after that, so turning one on never sweeps the backlog.

-- ---------------------------------------------------------------------------
-- 1. The switches.
-- One row per business. `settings` is the owner's choices (which automations
-- are on, unit costs, cadence, keywords); `started` is when each automation
-- was first switched on, so it never acts on what came before.
--
-- Here and on the other tables below that drive sends or money, a signed-in
-- user may only read: writes go through server actions that check the
-- caller is an owner, and then use the service role.
create table if not exists public.marketing_autopilot_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  started jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.marketing_autopilot_settings enable row level security;
drop policy if exists marketing_autopilot_settings_own_org on public.marketing_autopilot_settings;
create policy marketing_autopilot_settings_own_org on public.marketing_autopilot_settings
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 2. Plays that close themselves, and what each one cost and brought in.
--
-- closed_reason says how a play stopped being open: the walker's GPS trail
-- passed its doors ('gps'), the crew tapped "finished" at the job it was made
-- for ('crew_finished'), whoever it was assigned to tapped done ('assignee'),
-- a person ticked it off ('owner'), or it sat untouched for 30 days
-- ('expired', status skipped, with the note saying so). cost_cents is stamped
-- when the play closes, from the unit costs in settings at that moment, so a
-- later change of printer does not rewrite what last spring cost.
alter table public.marketing_plays
  add column if not exists cost_cents integer,
  add column if not exists closed_reason text,
  add column if not exists closed_note text,
  add column if not exists coverage real;

-- The walk, as the walker's phone reported it. Written two ways: by the
-- "Walk this round" button (source 'walk'), and from crew_positions while a
-- person with an open round nearby has the app open (source 'beacon').
create table if not exists public.marketing_play_trail (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  play_id uuid not null references public.marketing_plays(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  source text not null default 'walk' check (source in ('walk', 'beacon')),
  at timestamptz not null default now()
);
create index if not exists marketing_play_trail_play_idx on public.marketing_play_trail (play_id, at);
alter table public.marketing_play_trail enable row level security;
drop policy if exists marketing_play_trail_read on public.marketing_play_trail;
create policy marketing_play_trail_read on public.marketing_play_trail
  for select to authenticated
  using (organization_id = (select current_org_id()));
drop policy if exists marketing_play_trail_own_write on public.marketing_play_trail;
create policy marketing_play_trail_own_write on public.marketing_play_trail
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and profile_id = (select auth.uid()));

-- A phone reporting its position near a round its person has been given
-- leaves a trail point on that round. Only for open, approved rounds of doors
-- assigned to that person, within a mile of the house, and only with a fix
-- good enough to say which side of the street. Never allowed to break the
-- position report itself: any failure here is swallowed.
create or replace function public.marketing_trail_from_position()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.accuracy_m is not null and new.accuracy_m > 60 then
      return new;
    end if;
    insert into marketing_play_trail (organization_id, play_id, profile_id, lat, lng, accuracy_m, source, at)
    select new.organization_id, m.id, new.profile_id, new.lat, new.lng, new.accuracy_m, 'beacon', new.at
    from marketing_plays m
    join houses h on h.id = m.house_id
    where m.organization_id = new.organization_id
      and m.assigned_to = new.profile_id
      and m.status = 'open'
      and m.approval <> 'pending'
      and m.kind in ('door_hangers', 'knocks', 'yard_sign')
      and ST_DWithin(house_geom(h.lng, h.lat)::geography, house_geom(new.lng::numeric, new.lat::numeric)::geography, 1600);
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists crew_positions_marketing_trail on public.crew_positions;
create trigger crew_positions_marketing_trail
  after insert or update of lat, lng on public.crew_positions
  for each row execute function public.marketing_trail_from_position();

-- What a finished play brought in: bookings from addresses in its zone (or
-- its own doors, when it has no zone) made after the drop, within the 60-day
-- credit window attribution.ts uses. The client's own job is not counted.
-- Runs as the caller, so RLS still applies to a signed-in reader.
create or replace function public.marketing_play_results(org uuid, since timestamptz)
returns table (play_id uuid, leads integer, sold integer)
language sql stable set search_path = public as $$
  with plays as (
    select m.id, m.zone_id, m.targets, m.kind, m.done_at, m.customer_id
    from marketing_plays m
    where m.organization_id = org and m.status = 'done' and m.done_at is not null and m.done_at >= since
  ),
  reached as (
    select p.id as play_id, zh.house_id
    from plays p join zone_houses zh on zh.zone_id = p.zone_id
    where p.zone_id is not null
    union
    select p.id, (t.value)::uuid
    from plays p cross join lateral jsonb_array_elements_text(case when p.kind = 'flyers' then '[]'::jsonb else p.targets end) t
    where p.zone_id is null
  )
  select p.id,
    count(distinct j.id)::integer,
    count(distinct j.id) filter (where j.status in ('approved', 'in_progress', 'completed'))::integer
  from plays p
  left join reached r on r.play_id = p.id
  left join houses h on h.id = r.house_id and h.property_id is not null
  left join jobs j on j.property_id = h.property_id
    and j.created_at > p.done_at
    and j.created_at <= p.done_at + interval '60 days'
    and j.status <> 'cancelled'
  left join properties pr on pr.id = j.property_id
  where j.id is null or pr.customer_id is distinct from p.customer_id
  group by p.id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Google Business Profile: reviews, their replies, insights, posts.
--
-- A review pulled from Google is kept once, by Google's own name for it. The
-- reply is drafted by the app; 4-5 stars post on their own when that is
-- switched on, 1-3 stars wait here ('held') for a person.
create table if not exists public.google_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  review_name text not null,
  author text,
  stars smallint check (stars between 1 and 5),
  body text,
  reviewed_at timestamptz,
  remote_updated_at timestamptz,
  -- none | drafted | held | posted | failed | skipped | existing
  reply_status text not null default 'none'
    check (reply_status in ('none', 'drafted', 'held', 'posted', 'failed', 'skipped', 'existing')),
  reply_draft text,
  reply_body text,
  reply_posted_at timestamptz,
  reply_error text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  booking_proof_id uuid references booking_proof(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, review_name)
);
create index if not exists google_reviews_org_idx on public.google_reviews (organization_id, reviewed_at desc);
create index if not exists google_reviews_held_idx on public.google_reviews (organization_id) where reply_status = 'held';
alter table public.google_reviews enable row level security;
drop policy if exists google_reviews_own_org on public.google_reviews;
create policy google_reviews_own_org on public.google_reviews
  for select to authenticated
  using (organization_id = (select current_org_id()));

create table if not exists public.google_business_insights (
  organization_id uuid not null references organizations(id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  directions integer not null default 0,
  website_clicks integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, day)
);
alter table public.google_business_insights enable row level security;
drop policy if exists google_business_insights_own_org on public.google_business_insights;
create policy google_business_insights_own_org on public.google_business_insights
  for select to authenticated
  using (organization_id = (select current_org_id()));

create table if not exists public.google_business_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  social_post_id uuid references social_posts(id) on delete set null,
  remote_name text,
  summary text,
  image_url text,
  status text not null default 'posted' check (status in ('posted', 'failed')),
  error text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, social_post_id)
);
alter table public.google_business_posts enable row level security;
drop policy if exists google_business_posts_own_org on public.google_business_posts;
create policy google_business_posts_own_org on public.google_business_posts
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 4. Spend and platform leads, so cost per lead and CAC can be worked out.
--
-- One row per channel per day per campaign, from the Google Ads API, a CSV
-- the owner uploaded, or typed in. external_key makes a re-import replace
-- rather than double: 'google_ads:2026-10-01:1234567' and the like.
create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel text not null,
  day date not null,
  amount_cents integer not null default 0,
  clicks integer,
  impressions integer,
  platform_leads integer,
  campaign text,
  source text not null default 'manual' check (source in ('api', 'csv', 'manual')),
  external_key text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_key)
);
create index if not exists marketing_spend_org_day_idx on public.marketing_spend (organization_id, day desc);
alter table public.marketing_spend enable row level security;
drop policy if exists marketing_spend_own_org on public.marketing_spend;
create policy marketing_spend_own_org on public.marketing_spend
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- Leads a platform reports on its own (Local Services Ads calls and
-- messages), which never pass through the booking page.
create table if not exists public.marketing_platform_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null,
  external_id text not null,
  lead_type text,
  category text,
  charged boolean,
  phone text,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, external_id)
);
create index if not exists marketing_platform_leads_org_idx on public.marketing_platform_leads (organization_id, occurred_at desc);
alter table public.marketing_platform_leads enable row level security;
drop policy if exists marketing_platform_leads_own_org on public.marketing_platform_leads;
create policy marketing_platform_leads_own_org on public.marketing_platform_leads
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 5. Seasonal cross-sell runs. One per season per year: the owner starts it
-- after a preview, or it starts itself when automatic and past its go-live
-- date. The sends themselves are in client_message_log under
-- 'seasonal:<season>:<year>:<customer>', which is what stops a second send.
create table if not exists public.seasonal_campaign_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season text not null,
  year integer not null,
  mode text not null default 'owner' check (mode in ('owner', 'auto')),
  status text not null default 'sending' check (status in ('sending', 'done', 'cancelled')),
  audience integer not null default 0,
  sent integer not null default 0,
  skipped integer not null default 0,
  started_by uuid references profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, season, year)
);
alter table public.seasonal_campaign_runs enable row level security;
drop policy if exists seasonal_campaign_runs_own_org on public.seasonal_campaign_runs;
create policy seasonal_campaign_runs_own_org on public.seasonal_campaign_runs
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------------------------------------------------------------------------
-- 6. Posts the app scheduled itself from crew-approved photos, so the studio
-- can say which ones nobody pressed approve on.
alter table public.social_posts add column if not exists auto_source text;

notify pgrst, 'reload schema';
