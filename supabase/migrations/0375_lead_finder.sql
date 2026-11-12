-- The lead finder: commercial, church, HOA and apartment properties near
-- Forest Hill and Bel Air, from the State's free assessment roll (and the
-- hand-made business list), with the office's weekly look at each one.
--
-- One row per property. The roll's facts are written when it is pulled; the
-- review (the ticked rubric boxes, the 0-10 score, the suggested services,
-- a note) is the office's. week_of is the Monday of the week it was put on
-- the list, so nothing is looked at twice. A property scored high enough is
-- made into a lead_prospects row and linked back.
--
-- owner_name and owner_mailing are kept for organizations only (an LLC, a
-- church, an HOA, a management company); for a property a person owns the
-- app keeps neither, only owner_state.
--
-- Same business only. Additive only. No `drop ... if exists` (NOTICEs hang
-- the SQL runner); the policy is made in a guarded DO block.

create table if not exists public.lead_finder_parcels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default current_org_id() references public.organizations(id) on delete cascade,
  source text not null check (source in ('sdat', 'seed', 'manual')),
  -- 'sdat:<account>' or 'seed:<slug>': pulling or importing again updates, never duplicates.
  source_key text not null,
  name text not null,
  category text not null check (category in ('commercial', 'church', 'hoa', 'apartments', 'industrial', 'institution')),
  address text not null,
  address_key text not null,
  city text,
  zip text,
  lat double precision,
  lng double precision,
  land_use text,
  acreage numeric,
  assessed_value numeric,
  owner_name text,
  owner_mailing text,
  owner_state text,
  phone text,
  website text,
  seed_priority text check (seed_priority is null or seed_priority in ('A', 'B', 'C')),
  -- Rank before anyone has looked: higher is looked at first.
  priority numeric not null default 0,
  status text not null default 'new' check (status in ('new', 'reviewed', 'lead', 'skipped')),
  week_of date,
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  score smallint check (score is null or (score between 0 and 10)),
  services text[] not null default '{}',
  note text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  lead_prospect_id uuid references public.lead_prospects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

create index if not exists lead_finder_parcels_week_idx on public.lead_finder_parcels (organization_id, week_of);
create index if not exists lead_finder_parcels_queue_idx on public.lead_finder_parcels (organization_id, status, priority desc);

comment on table public.lead_finder_parcels is
  'Lead finder: non-residential parcels from the SDAT roll (and the seed business list), with the weekly 0-10 landscaping-need review.';

alter table public.lead_finder_parcels enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lead_finder_parcels' and policyname = 'lead_finder_parcels_own_org') then
    create policy lead_finder_parcels_own_org on public.lead_finder_parcels
      for all to authenticated
      using (organization_id = (select current_org_id()))
      with check (organization_id = (select current_org_id()));
  end if;
end
$$;
