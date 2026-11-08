-- Google ads made from finished-job photos, waiting for the owner's yes.
--
-- Each finished job with an "after" photo becomes one draft: the photo and
-- the words. The budget and what it should bring back are worked out when
-- the owner looks, from how the ads are doing that day, and kept with the
-- draft when they approve, so what they said yes to stays on record.
-- Approving launches it live in Google Ads.
--
-- Additive only.

create table if not exists public.ad_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  photo_id uuid references job_photos(id) on delete set null,
  name text not null,
  headlines text[] not null,
  descriptions text[] not null,
  keywords text[] not null default '{}',
  zip text,
  status text not null default 'draft' check (status in ('draft', 'launched', 'skipped', 'failed')),
  daily_budget_cents integer check (daily_budget_cents is null or daily_budget_cents between 100 and 100000),
  -- What the owner was shown when they approved: 30-day spend, leads, jobs, revenue, return.
  estimate jsonb,
  google_campaign text,
  error text,
  -- Why the owner said no, so the next ads can avoid it.
  no_reason text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, job_id)
);

comment on table public.ad_drafts is
  'One Google ad made from a finished job''s photo. Nothing is sent to Google until the owner approves; then it launches live with the budget they approved.';

create index if not exists ad_drafts_org_status_idx on public.ad_drafts (organization_id, status, created_at desc);

alter table public.ad_drafts enable row level security;
drop policy if exists ad_drafts_own_org on public.ad_drafts;
create policy ad_drafts_own_org on public.ad_drafts
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
