-- Stage 2 of the job pipeline: the resource properties library.
--
-- Stage 1 (0391) is what one customer's project needs. Stage 2 is what the
-- company knows, reused by every project: for each material, its subtypes,
-- and for each operation on them, the production rates, the standards the
-- evaluator should not be asked for (mulch depth), what to measure on site,
-- and the shared tools, equipment, labor and disposal it needs.
--
--   Material -> Subtype -> Operation -> Properties and dependencies
--
-- A Stage 1 work item (remove / plant / japanese_barberry) finds its
-- operation here by operation + material + subtype. An operation with no
-- subtype applies to every subtype of the material that has none of its
-- own, so "remove any plant" is written once and a species only gets its
-- own row when it differs.
--
-- Shared resources (a shovel, the dump trailer, a technician hour) are
-- defined once in library_resources and referenced by every operation
-- that uses them, never copied.
--
-- library_files keeps resources.msgpack: the whole library packed as
-- MessagePack, versioned, for the calculation stage to load in one read.
-- Until a business has rows of its own the app uses the starting library
-- in src/lib/resource-library.ts.

create table if not exists public.library_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),          -- plant, mulch, stone
  name text not null,                                         -- Plant
  -- {"physical": {...}, "chemical_biological": {...}, "financial": {...}}
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists public.library_subtypes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.library_materials(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),          -- japanese_barberry
  name text not null,                                         -- Japanese barberry
  -- Overrides and adds to the material's properties, e.g.
  -- {"physical": {"density_ton_per_cuyd": 1.35}, "chemical_biological": {"root_system": "fibrous"}}
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, key)
);

create table if not exists public.library_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),          -- round_point_shovel
  kind text not null check (kind in ('tool', 'equipment', 'labor', 'consumable', 'disposal', 'vehicle')),
  name text not null,
  -- Operating characteristics, e.g. {"capacity_cuyd": 5}.
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  -- What it costs to own and use, e.g. {"purchase_cents": 4500, "life_hours": 400}
  -- or {"per_hour_cents": 9500} or {"per_ton_cents": 6500}.
  costs jsonb not null default '{}' check (jsonb_typeof(costs) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists public.library_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.library_materials(id) on delete cascade,
  -- Null: applies to every subtype of the material without its own row.
  subtype_id uuid references public.library_subtypes(id) on delete cascade,
  operation text not null check (operation in ('install', 'remove', 'maintain')),
  -- The unit the evaluator's quantity comes in (Stage 1).
  unit text not null check (unit in ('sqft', 'lnft', 'sqyd', 'cuyd', 'each', 'ton', 'lb', 'gal', 'hr')),
  -- The unit the production rate is per, when it differs (mulch: sqft in, cuyd rated).
  rate_unit text not null check (rate_unit in ('sqft', 'lnft', 'sqyd', 'cuyd', 'each', 'ton', 'lb', 'gal', 'hr')),
  -- Company standards the evaluator is never asked for, e.g. {"depth_in": 3}.
  standards jsonb not null default '{}' check (jsonb_typeof(standards) = 'object'),
  -- What the evaluator must measure, observe or photograph for this work, e.g.
  -- [{"key": "size_class", "options": ["small", "medium", "large"], "evidence": "photo"}].
  measure jsonb not null default '[]' check (jsonb_typeof(measure) = 'array'),
  -- Words the proposal is written from, e.g. "Remove {qty} existing {subtype}, including root removal and debris disposal."
  scope_text text,
  -- Anything else: procedures, constraints, dependencies.
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per operation for the material, and one per operation per subtype.
create unique index if not exists library_operations_material_idx
  on public.library_operations (material_id, operation) where subtype_id is null;
create unique index if not exists library_operations_subtype_idx
  on public.library_operations (subtype_id, operation) where subtype_id is not null;

-- Production rates. An operation can have several, picked by the work
-- item's measurements: {"size_class": "large"} matches a large shrub; {}
-- is the rate when nothing more specific matches.
create table if not exists public.library_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id uuid not null references public.library_operations(id) on delete cascade,
  "when" jsonb not null default '{}' check (jsonb_typeof("when") = 'object'),
  minutes_per_unit numeric(12,4) not null check (minutes_per_unit >= 0),
  -- Where the number came from, e.g. "Production rates sheet: Medium shrub removal".
  source text,
  status text not null default 'provisional' check (status in ('provisional', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists library_rates_operation_idx on public.library_rates (operation_id);

-- Which shared resources an operation needs, and how much.
create table if not exists public.library_operation_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id uuid not null references public.library_operations(id) on delete cascade,
  resource_id uuid not null references public.library_resources(id) on delete restrict,
  amount numeric(12,4) not null default 1 check (amount >= 0),
  -- job: once per job; unit: per unit of work; labor_hour: per hour of labor.
  per text not null default 'job' check (per in ('job', 'unit', 'labor_hour')),
  unique (operation_id, resource_id)
);

create table if not exists public.library_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage integer not null default 2 check (stage = 2),
  version integer not null check (version >= 1),
  format text not null default 'msgpack' check (format in ('msgpack')),
  schema_version integer not null default 1,
  content bytea not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, version)
);

do $$
declare t text;
begin
  foreach t in array array['library_materials', 'library_subtypes', 'library_resources', 'library_operations',
                           'library_rates', 'library_operation_needs', 'library_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_org', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (organization_id = current_org_id())
                      with check (organization_id = current_org_id())', t || '_own_org', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
