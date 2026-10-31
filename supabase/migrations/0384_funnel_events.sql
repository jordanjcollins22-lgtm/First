-- Each page of the client funnel, as people reach and leave it:
--
--   details_shown   the "how do we reach you?" page of booking (by visit)
--   lead            details sent: a job and its pre-evaluation link exist
--   map_opened      the map pre-evaluation opened
--   map_tapped      first spot tapped on the map
--   map_sent        "Done, see my estimate": the estimate was worked out
--   estimate_viewed the estimate page opened
--   pay_started     sent to the card page, for a deposit or a paid evaluation
--   paid            the money landed
--   schedule_viewed the visit-time page opened, after paying
--   visit_booked    a visit time picked and booked
--
-- The booking page's own opens are already in booking_visits. One row per
-- time a step happens; the admin funnel page counts distinct people per step,
-- so a reload is not a second person. Written only by the server.
create table if not exists funnel_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Who: the booking page visit before there is a job, the job after.
  visit_id uuid references booking_visits(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  step text not null check (step in (
    'details_shown', 'lead', 'map_opened', 'map_tapped', 'map_sent',
    'estimate_viewed', 'pay_started', 'paid', 'schedule_viewed', 'visit_booked'
  )),
  -- A little more about it: "deposit" or a tier id on pay_started and paid.
  detail text,
  created_at timestamptz not null default now(),
  check (visit_id is not null or job_id is not null)
);

create index if not exists funnel_events_org_idx on funnel_events (organization_id, created_at desc);
create index if not exists funnel_events_job_idx on funnel_events (job_id, step);

alter table funnel_events enable row level security;

drop policy if exists funnel_events_own_org on funnel_events;
create policy funnel_events_own_org on funnel_events
  for select using (organization_id = current_org_id());

comment on table funnel_events is
  'Each page of the client funnel (details, map, estimate, payment, visit time) as people reach it. Counted on the admin Funnel page.';
