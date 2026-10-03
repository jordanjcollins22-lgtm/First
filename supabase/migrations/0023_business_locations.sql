create table if not exists business_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on business_locations;
create trigger set_updated_at before update on business_locations for each row execute function set_updated_at();

create table if not exists location_areas (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references business_locations(id) on delete cascade,
  name text not null,
  geometry_type text not null check (geometry_type in ('point_radius', 'polygon', 'zip_list')),
  geometry jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on location_areas;
create trigger set_updated_at before update on location_areas for each row execute function set_updated_at();

alter table business_locations enable row level security;
alter table location_areas enable row level security;

drop policy if exists "authenticated_full_access" on business_locations;
create policy "authenticated_full_access" on business_locations for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on location_areas;
create policy "authenticated_full_access" on location_areas for all to authenticated using (true) with check (true);
