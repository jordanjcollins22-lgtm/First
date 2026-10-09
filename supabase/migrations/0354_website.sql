-- The business's own website, written and published from the new layout's
-- Marketing page. One row per business: everything the site says, as one
-- JSON document, so a new section is a new key rather than a migration.
-- Saving publishes; the public page at /site reads the latest row.
create table if not exists public.website_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.website_settings enable row level security;
drop policy if exists website_settings_own_org on public.website_settings;
create policy website_settings_own_org on public.website_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
