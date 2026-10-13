-- Every outside service's login, in one place: Admin › Settings › Integrations.
--
-- One row per business per provider (google_business, google_ads, quickbooks,
-- payroll, weather, …). `secrets` holds keys and tokens and is read only by
-- server code with the service role: like meta_settings, no policy grants a
-- signed-in user any access, so the page shows whether a key is present,
-- never the key. `settings` holds the non-secret choices made on connect.
create table if not exists public.integration_credentials (
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null,
  secrets jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'error')),
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  primary key (organization_id, provider)
);
alter table public.integration_credentials enable row level security;
