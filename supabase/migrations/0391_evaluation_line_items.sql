-- Stage 1 of the job pipeline: what comes out of the evaluation form.
--
-- The job moves through stages the way a wafer moves through a fab. Each
-- stage takes the last stage's output file and makes its own. Stage 1 is the
-- evaluation: one line per piece of work, e.g.
--   install / mulch / brown_hardwood / 200 sqft / front_bed
-- with the field readings (site_conditions) and the photos and samples that
-- back it up (evidence). Stage 2 reads these lines.
--
-- Two tables:
--   evaluation_line_items  the lines themselves, one row each, so the app can
--                          edit, list and total them.
--   job_stage_files        the file a stage hands to the next one. For stage 1
--                          it is every line of the job packed as MessagePack.
--                          A new file is a new version; old versions stay, so
--                          we can always see what a later stage was given.

create table if not exists public.evaluation_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Order on the form.
  position integer not null default 0,
  -- What is done: install, remove or maintain.
  operation text not null check (operation in ('install', 'remove', 'maintain')),
  -- What it is done with, e.g. mulch.
  material text not null check (material ~ '^[a-z0-9_]+$'),
  -- Which kind of it, e.g. brown_hardwood. Null when the material has none.
  subtype text check (subtype is null or subtype ~ '^[a-z0-9_]+$'),
  -- How much, measured.
  quantity numeric(12,3) not null check (quantity >= 0),
  -- What the quantity counts: sqft, lnft, cuyd, each, ...
  unit text not null check (unit in ('sqft', 'lnft', 'sqyd', 'cuyd', 'each', 'ton', 'lb', 'gal', 'hr')),
  -- Where on the property, e.g. front_bed.
  location text not null check (location ~ '^[a-z0-9_]+$'),
  -- Field measurements and test results, e.g. {"soil_ph": 6.4, "slope_pct": 8}.
  site_conditions jsonb not null default '{}' check (jsonb_typeof(site_conditions) = 'object'),
  -- References to photos and samples, e.g.
  -- [{"kind": "photo", "ref": "job-photos/abc.jpg", "label": "Core sample"}].
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evaluation_line_items_job_idx
  on public.evaluation_line_items (job_id, position);

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
  -- 1 = evaluation line items. Later stages get the next numbers.
  stage integer not null check (stage >= 1),
  -- 1, 2, 3 ... per job and stage. The highest is the current file.
  version integer not null default 1 check (version >= 1),
  format text not null default 'msgpack' check (format in ('msgpack')),
  -- Version of the layout inside the file, so a reader knows how to read it.
  schema_version integer not null default 1,
  content bytea not null,
  -- sha256 of content, hex, so a stage can confirm it got the file intact.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
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
