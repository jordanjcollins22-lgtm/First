-- Govcon scale-up: revenue tracking, state/local portals, uploaded documents,
-- SAM entity registry for local small subs.

-- New status for portal bids whose documents need a vendor login to download.
alter table govcon_opportunities drop constraint if exists govcon_opportunities_status_check;
alter table govcon_opportunities add constraint govcon_opportunities_status_check check (status in (
  'new', 'needs_docs', 'sourcing', 'awaiting_quotes', 'ready', 'submitted', 'won', 'lost', 'no_bid', 'expired'
));

alter table govcon_opportunities add column if not exists expected_annual_value numeric;
alter table govcon_opportunities add column if not exists priority integer not null default 0;
alter table govcon_opportunities add column if not exists estimated_at timestamptz;
-- Documents a human uploaded (storage paths in the govcon-docs bucket).
alter table govcon_opportunities add column if not exists uploaded_docs jsonb not null default '[]';
create index if not exists govcon_opps_priority_idx on govcon_opportunities(status, priority desc);

-- ============================================================
-- govcon_contracts: won work in performance — drives the revenue run-rate
-- ============================================================
create table if not exists govcon_contracts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references govcon_opportunities(id) on delete cascade,
  bid_id uuid references govcon_bids(id) on delete set null,
  subcontractor_id uuid references govcon_subcontractors(id) on delete set null,
  contract_number text,
  total_value numeric not null default 0,
  annual_value numeric not null default 0,
  sub_annual_cost numeric not null default 0,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'complete', 'terminated')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- govcon_sam_entities: SAM.gov public entity extract, filtered to our NAICS.
-- Local, registered, self-declared-small firms = similarly-situated subs.
-- ============================================================
create table if not exists govcon_sam_entities (
  uei text primary key,
  cage text,
  legal_name text not null,
  dba_name text,
  address text,
  city text,
  state text,
  zip5 text,
  website text,
  naics text[] not null default '{}',
  small_naics text[] not null default '{}',
  business_types text[] not null default '{}',
  poc_name text,
  registration_expires date,
  extract_date date,
  updated_at timestamptz not null default now()
);
create index if not exists govcon_sam_entities_state_idx on govcon_sam_entities(state);
create index if not exists govcon_sam_entities_naics_idx on govcon_sam_entities using gin(naics);
create index if not exists govcon_sam_entities_zip3_idx on govcon_sam_entities(left(zip5, 3));

do $$
declare
  t text;
begin
  foreach t in array array['govcon_contracts', 'govcon_sam_entities']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
  execute 'drop trigger if exists set_updated_at on govcon_contracts; create trigger set_updated_at before update on govcon_contracts for each row execute function set_updated_at();';
end $$;

-- Private bucket for solicitation documents uploaded by hand (portal bids).
insert into storage.buckets (id, name, public)
values ('govcon-docs', 'govcon-docs', false)
on conflict (id) do nothing;
