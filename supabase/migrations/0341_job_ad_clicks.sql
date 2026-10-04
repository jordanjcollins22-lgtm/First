-- Which ad a booking came from. Google and Facebook put a click id on the
-- link when somebody taps an ad (?gclid=, ?fbclid=); kept with the job so a
-- sold job can be reported back to the ad that found it, and so the office
-- can see which ads bring work rather than which bring clicks.
create table if not exists job_ad_clicks (
  job_id uuid primary key references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Meta's click id in its own format, and its browser cookie.
  fbc text,
  fbp text,
  -- Google's click ids: gclid, or gbraid/wbraid from iPhones.
  gclid text,
  gbraid text,
  wbraid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  -- Sent with the events so Meta can match the person; only kept for ad clicks.
  client_ip text,
  client_user_agent text,
  meta_lead_reported_at timestamptz,
  meta_purchase_reported_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table job_ad_clicks is
  'The ad click a booking came from (Google or Facebook click ids, utm tags), and when it was reported back to Meta.';

create index if not exists job_ad_clicks_org_idx on job_ad_clicks (organization_id, created_at desc);

alter table job_ad_clicks enable row level security;

create policy job_ad_clicks_own_org on job_ad_clicks
  for select to authenticated
  using (organization_id = current_org_id());

notify pgrst, 'reload schema';
