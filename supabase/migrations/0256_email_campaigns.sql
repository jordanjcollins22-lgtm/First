-- Email campaigns that book work.
--
-- One offer, sent to the list a little at a time in more than one wording,
-- each person with their own code, each send and click and booking written
-- against the wording that produced it. The rules that decide what goes
-- out are in lib/campaign.ts; these tables remember.
--
-- Reputation is the constraint. A sending domain that lands in spam cannot
-- send a proposal either, so the cron ramps up slowly, stops on bounces or
-- complaints, and never writes to anybody who has unsubscribed. Those facts
-- live on the recipient row so the count of each is one query.

create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'done')),
  -- The credit on offer and when its code stops working.
  offer_cents integer not null default 1743 check (offer_cents >= 0),
  code_expires_on date not null,
  service_label text not null default 'Aeration and overseeding',
  -- How the service is priced from the lot: lib/campaign.ts AerationPricing.
  pricing jsonb not null default '{}'::jsonb,
  -- How the sending grows: lib/campaign.ts RampPlan.
  ramp jsonb not null default '{}'::jsonb,
  -- Why the sender stopped, when it stopped itself.
  paused_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table email_campaigns enable row level security;
drop policy if exists email_campaigns_own_org on email_campaigns;
create policy email_campaigns_own_org on email_campaigns
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- The wordings. Sends, clicks and bookings are counted off the recipients.
create table if not exists email_campaign_variants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  subject text not null,
  body text not null,
  -- True when the wording quotes a price, so it only goes to a lawn we can size.
  needs_price boolean not null default false,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (campaign_id, key)
);

alter table email_campaign_variants enable row level security;
drop policy if exists email_campaign_variants_own_org on email_campaign_variants;
create policy email_campaign_variants_own_org on email_campaign_variants
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- One row per person the campaign will write to, with what happened.
create table if not exists email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  email text not null,
  name text,
  -- Their code. The offer page is reached by it and the credit is applied by it.
  code text not null unique,
  variant_id uuid references email_campaign_variants(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'skipped', 'bounced', 'complained', 'unsubscribed')),
  skip_reason text,
  provider_id text,
  -- What the offer page worked out for them, kept so the email and the page agree.
  lawn_sqft integer,
  price_cents integer,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  booked_at timestamptz,
  booked_job_id uuid references jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists email_campaign_recipients_queue_idx
  on email_campaign_recipients (campaign_id, status, created_at);
create index if not exists email_campaign_recipients_provider_idx
  on email_campaign_recipients (provider_id) where provider_id is not null;

alter table email_campaign_recipients enable row level security;
drop policy if exists email_campaign_recipients_own_org on email_campaign_recipients;
create policy email_campaign_recipients_own_org on email_campaign_recipients
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

comment on table email_campaigns is
  'An offer emailed to the list a little at a time, in more than one wording, with each person''s own code.';
