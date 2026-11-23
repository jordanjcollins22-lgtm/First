-- Stage 1 of the job pipeline: what comes out of the evaluation form.
--
-- The job moves through stages the way a wafer moves through a fab. Each
-- stage takes the last stage's output file and makes its own. Stage 1 is the
-- evaluation, laid out as:
--
--   project (the job)
--     zones: front_mulch_bed, backyard, ... each with its own location,
--            field readings (site_conditions) and photos/samples (evidence)
--       work items: remove / plant / japanese_barberry / 2 each
--                   install / mulch / brown_hardwood / 200 sqft
--
-- Stage 2 reads these. Three tables:
--   evaluation_zones       the zones of a job.
--   evaluation_line_items  the work items in each zone, one row each, so the
--                          app can edit, list and total them.
--   job_stage_files        the file a stage hands to the next one. For stage 1
--                          it is the whole job packed as MessagePack. A new
--                          file is a new version; old versions stay, so we
--                          can always see what a later stage was given.

create table if not exists public.evaluation_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- 1, 2, 3 ... within the job, as written in the file.
  zone_no integer not null check (zone_no >= 1),
  -- e.g. front_mulch_bed.
  name text not null check (name ~ '^[a-z0-9_]+$'),
  -- Where on the property, when the name doesn't say it. Optional.
  location text check (location is null or location ~ '^[a-z0-9_]+$'),
  -- Field measurements and test results, e.g. {"soil_ph": 6.4, "slope_pct": 8}.
  site_conditions jsonb not null default '{}' check (jsonb_typeof(site_conditions) = 'object'),
  -- References to photos and samples, e.g.
  -- [{"kind": "photo", "ref": "job-photos/abc.jpg", "label": "Core sample"}].
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, zone_no)
);

alter table public.evaluation_zones enable row level security;
drop policy if exists evaluation_zones_own_org on public.evaluation_zones;
create policy evaluation_zones_own_org on public.evaluation_zones
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create table if not exists public.evaluation_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  zone_id uuid not null references public.evaluation_zones(id) on delete cascade,
  -- Stable number of the work item within the project (1, 2, 3 ...), so
  -- calculations, photos and completed work stay tied to the right item.
  item_no integer not null check (item_no >= 1),
  -- Order within the zone.
  position integer not null default 0,
  -- What is done: install, remove or maintain.
  operation text not null check (operation in ('install', 'remove', 'maintain')),
  -- What it is done with, e.g. mulch, plant, stone.
  material text not null check (material ~ '^[a-z0-9_]+$'),
  -- Which kind of it, e.g. brown_hardwood, japanese_barberry. Null when none.
  subtype text check (subtype is null or subtype ~ '^[a-z0-9_]+$'),
  -- How much, measured.
  quantity numeric(12,3) not null check (quantity >= 0),
  -- What the quantity counts: sqft, lnft, cuyd, each, ...
  unit text not null check (unit in ('sqft', 'lnft', 'sqyd', 'cuyd', 'each', 'ton', 'lb', 'gal', 'hr')),
  -- Measurements of this item that change how it is done, each marked as
  -- measured, estimated or inferred, e.g.
  -- {"size_class": {"value": "large", "source": "measured"},
  --  "height_ft": {"value": 6, "unit": "ft", "source": "estimated"}}.
  measurements jsonb not null default '{}' check (jsonb_typeof(measurements) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evaluation_line_items_zone_idx
  on public.evaluation_line_items (zone_id, position);
create unique index if not exists evaluation_line_items_job_item_idx
  on public.evaluation_line_items (job_id, item_no);

alter table public.evaluation_line_items enable row level security;
drop policy if exists evaluation_line_items_own_org on public.evaluation_line_items;
create policy evaluation_line_items_own_org on public.evaluation_line_items
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create table if not exists public.job_stage_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- 1 = evaluation zones and work items. Later stages get the next numbers.
  stage integer not null check (stage >= 1),
  -- 1, 2, 3 ... per job and stage. The highest is the current file.
  version integer not null default 1 check (version >= 1),
  format text not null default 'msgpack' check (format in ('msgpack')),
  -- Version of the layout inside the file, so a reader knows how to read it.
  schema_version integer not null default 1,
  content bytea not null,
  -- sha256 of content, hex, so a stage can confirm it got the file intact.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Work items in the file.
  item_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, stage, version)
);

create index if not exists job_stage_files_current_idx
  on public.job_stage_files (job_id, stage, version desc);

alter table public.job_stage_files enable row level security;
drop policy if exists job_stage_files_own_org on public.job_stage_files;
create policy job_stage_files_own_org on public.job_stage_files
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
