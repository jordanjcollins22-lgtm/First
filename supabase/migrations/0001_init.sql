-- Field estimating app: core schema
-- Customer -> Property -> Job -> Zone -> WorkArea, with ServiceTemplate + Photo.
-- Geometry is stored as GeoJSON (jsonb) rather than PostGIS geometry for MVP
-- simplicity; all measurement math happens in the app layer (Turf.js) against
-- these true [lng, lat] coordinates, never derived from screen pixels.

create extension if not exists "pgcrypto";

-- ============================================================
-- customers
-- ============================================================
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- properties
-- ============================================================
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_customer_id_idx on properties(customer_id);

-- ============================================================
-- service_templates (data-driven; never hardcode services into the UI)
-- ============================================================
create table if not exists service_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  allowed_geometry_types text[] not null default '{}',
  required_measurement_type text not null check (required_measurement_type in ('area', 'length', 'count')),
  estimator_questions jsonb not null default '[]',
  required_photo_count integer not null default 0,
  crew_steps text[] not null default '{}',
  tools_required text[] not null default '{}',
  equipment_required text[] not null default '{}',
  materials_formula jsonb not null default '[]',
  quality_control_requirements text[] not null default '{}',
  before_photo_requirements text[] not null default '{}',
  after_photo_requirements text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- jobs
-- ============================================================
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null,
  status text not null default 'estimating'
    check (status in ('estimating', 'quoted', 'approved', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_property_id_idx on jobs(property_id);

-- ============================================================
-- zones (auto-clustered by proximity, manually overridable)
-- ============================================================
create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  name text not null,
  auto_named boolean not null default true,
  sequence_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zones_job_id_idx on zones(job_id);

-- ============================================================
-- work_areas
-- ============================================================
create table if not exists work_areas (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  zone_id uuid references zones(id) on delete set null,
  service_template_id uuid not null references service_templates(id),
  geometry jsonb not null,
  cleaned_geometry jsonb,
  calculated_measurements jsonb,
  notes text,
  sequence_order integer,
  status text not null default 'draft'
    check (status in ('draft', 'scoped', 'priced', 'approved', 'completed')),
  -- Geometry locking: once measurements have been used for a price sent to
  -- a customer, geometry_locked_at is set. Further edits must bump
  -- geometry_version rather than silently overwrite the numbers a quote was
  -- already based on.
  geometry_locked_at timestamptz,
  geometry_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_areas_job_id_idx on work_areas(job_id);
create index if not exists work_areas_zone_id_idx on work_areas(zone_id);
create index if not exists work_areas_service_template_id_idx on work_areas(service_template_id);

-- ============================================================
-- work_area_geometry_versions (history of locked geometry states)
-- ============================================================
create table if not exists work_area_geometry_versions (
  id uuid primary key default gen_random_uuid(),
  work_area_id uuid not null references work_areas(id) on delete cascade,
  version integer not null,
  geometry jsonb not null,
  cleaned_geometry jsonb,
  calculated_measurements jsonb,
  locked_at timestamptz not null default now(),
  reason text
);

create index if not exists work_area_geometry_versions_work_area_id_idx
  on work_area_geometry_versions(work_area_id);

-- ============================================================
-- photos
-- ============================================================
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  work_area_id uuid not null references work_areas(id) on delete cascade,
  storage_path text not null,
  stage text not null default 'reference' check (stage in ('before', 'after', 'reference')),
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists photos_work_area_id_idx on photos(work_area_id);

-- ============================================================
-- updated_at triggers
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'properties', 'jobs', 'zones', 'work_areas', 'service_templates']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- Row Level Security — MVP: permissive policies for authenticated users.
-- Auth is intentionally minimal for this internal tool; tighten later.
-- ============================================================
alter table customers enable row level security;
alter table properties enable row level security;
alter table jobs enable row level security;
alter table zones enable row level security;
alter table work_areas enable row level security;
alter table work_area_geometry_versions enable row level security;
alter table service_templates enable row level security;
alter table photos enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'properties', 'jobs', 'zones', 'work_areas',
    'work_area_geometry_versions', 'service_templates', 'photos'
  ]
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;
