-- Attractors Data: marketing "Attractor Waves" (car magnets, yard signs,
-- door hangers, digital ads, etc.) tracked with flexible geometry (a point +
-- radius, a polygon, a route, or a zip list) so the Attractors page can plot
-- them on a real map and, later, correlate them with which jobs/projects
-- they touched.

create table if not exists attractor_types (
  id text primary key,
  label text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into attractor_types (id, label, is_system) values
  ('moving', 'Moving', true),
  ('stationary', 'Stationary', true),
  ('one_off', 'One-Off', true),
  ('digital', 'Digital', true)
on conflict (id) do nothing;

create table if not exists attractor_variants (
  id uuid primary key default gen_random_uuid(),
  type_id text not null references attractor_types(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (type_id, name)
);

insert into attractor_variants (type_id, name) values
  ('moving', 'Car Magnet'),
  ('moving', 'Plane Flag'),
  ('moving', 'Box Truck'),
  ('moving', 'Branded Vehicle'),
  ('stationary', 'Yard Sign'),
  ('stationary', 'A-Frame Sign'),
  ('stationary', 'Billboard'),
  ('one_off', 'Flyer'),
  ('one_off', 'Door Hanger'),
  ('one_off', 'Window Flyer'),
  ('digital', 'Social Media'),
  ('digital', 'Google Ads'),
  ('digital', 'Website'),
  ('digital', 'Digital Ads'),
  ('digital', 'Other Online')
on conflict (type_id, name) do nothing;

-- geometry_type + geometry (jsonb) let each wave use whatever real-world
-- shape actually fits it instead of forcing one measurement on everything:
--   point_radius: { lat, lng, radius_miles }
--   polygon:      { points: [{ lat, lng }, ...] }
--   route:        { points: [{ lat, lng }, ...], buffer_miles }
--   zip_list:     { zips: ["21201", ...] }  -- informational, not plotted
create table if not exists attractor_waves (
  id uuid primary key default gen_random_uuid(),
  type_id text not null references attractor_types(id),
  variant_id uuid references attractor_variants(id) on delete set null,
  name text not null,
  geometry_type text not null check (geometry_type in ('point_radius', 'polygon', 'route', 'zip_list')),
  geometry jsonb not null default '{}',
  date_planned date,
  date_completed date,
  quantity_deployed integer,
  status text not null default 'planned' check (status in ('planned', 'ready', 'completed')),
  notes text,
  leads_generated integer,
  projects_generated integer,
  revenue_generated numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on attractor_waves;
create trigger set_updated_at before update on attractor_waves for each row execute function set_updated_at();

alter table attractor_types enable row level security;
alter table attractor_variants enable row level security;
alter table attractor_waves enable row level security;

drop policy if exists "authenticated_full_access" on attractor_types;
create policy "authenticated_full_access" on attractor_types for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on attractor_variants;
create policy "authenticated_full_access" on attractor_variants for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on attractor_waves;
create policy "authenticated_full_access" on attractor_waves for all to authenticated using (true) with check (true);

-- Which wave (if known) actually generated a given job's lead. Coverage
-- (which waves' geometry a project's location falls inside) is computed at
-- render time from real coordinates instead of being duplicated in a table.
alter table jobs add column if not exists source_attractor_wave_id uuid references attractor_waves(id) on delete set null;
