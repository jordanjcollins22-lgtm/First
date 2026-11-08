-- The project pricing report and the one page of business variables.
--
-- 1. business_variables: one row per business, every number the pricing
--    report is worked out from (the 97 production rates, condition
--    multipliers, logistics, travel, crew, pay for performance, the indirect
--    cost pool, capacity and the capacity multipliers), kept as one JSON
--    document and read back through readVariables() in
--    src/lib/pricing-variables.ts, which fills anything missing from the
--    code's starting figures. Until a business saves, the starting figures
--    are used.
-- 2. pricing_estimates: one per job, the office's input to the report: each
--    area's measurements, tasks and confirmed conditions, what Claude read off
--    the photos (kept apart until somebody confirms it), the crew and the
--    job-specific direct costs.
--
-- Additive only. Reads are for the business's own people; every write goes
-- through the server, which checks for an owner or admin (variables) or
-- somebody who may price the job (estimates).

-- 1 ------------------------------------------------------------------------
create table if not exists public.business_variables (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  variables jsonb not null default '{}'::jsonb check (jsonb_typeof(variables) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.business_variables is
  'Every internal pricing and pay variable for the project pricing report, as one JSON document. Missing keys fall back to the code defaults.';

alter table public.business_variables enable row level security;
drop policy if exists business_variables_read on public.business_variables;
create policy business_variables_read on public.business_variables
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- 2 ------------------------------------------------------------------------
create table if not exists public.pricing_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint pricing_estimates_one_per_job unique (job_id)
);

comment on table public.pricing_estimates is
  'The office''s input to a job''s one-page pricing report: areas with measurements, tasks and confirmed conditions, photo suggestions, crew and direct costs.';

create index if not exists pricing_estimates_org_idx on public.pricing_estimates (organization_id, updated_at desc);

alter table public.pricing_estimates enable row level security;
drop policy if exists pricing_estimates_read on public.pricing_estimates;
create policy pricing_estimates_read on public.pricing_estimates
  for select to authenticated
  using (organization_id = (select current_org_id()));

notify pgrst, 'reload schema';
