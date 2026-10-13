-- Sales pipeline autopilot (workstream C).
--
-- 1. sales_autopilot_settings: one row per business. Whether a proposal
--    inside the price guardrails is approved and sent on its own, the gross
--    margin each division is held to, how far from the formula a price may
--    sit, the speed-to-proposal target, overdue exceptions, Good/Better/Best,
--    and the business's MHIC licence number for the contract block.
--    started_at is the go-live moment: only evaluations submitted after it
--    are ever acted on, so switching this on never sends the backlog.
-- 2. proposal_guardrail_checks: what the guardrails said about each draft,
--    and what the autopilot did with it, so a held price shows its reason.
--    One row per draft (job + generated_at): checking twice updates it.
-- 3. sales_exceptions: things in the pipeline that need a person, routed to
--    the person who can act: a proposal past the speed target goes to the
--    evaluator; a price held by the guardrails goes to the office. The crew
--    exceptions table (job_exceptions) keeps its thirteen field kinds; these
--    are sales kinds and live beside it. One open row per dedupe key.
-- 4. evaluator_territories: optional zip codes and drawn areas per
--    evaluator, preferred when routing a booking (from /book and from
--    GoHighLevel alike).
-- 5. services: a merged service is kept (old proposals still name it) and
--    marked merged, pointing at the one it was folded into. The status check
--    gains 'merged'; nothing is removed from it, and no row changes.
-- 6. merge_services(): folds one service into another in one transaction,
--    re-pointing every reference, under the caller's own row security.
--
-- Additive only. Not applied by the workstream: the coordinator applies it.

-- 1 ------------------------------------------------------------------------
create table if not exists public.sales_autopilot_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  auto_approve boolean not null default true,
  auto_send boolean not null default true,
  started_at timestamptz,
  margin_maintenance numeric not null default 0.50 check (margin_maintenance > 0 and margin_maintenance < 1),
  margin_install numeric not null default 0.30 check (margin_install > 0 and margin_install < 1),
  margin_snow numeric not null default 0.25 check (margin_snow > 0 and margin_snow < 1),
  margin_irrigation numeric not null default 0.45 check (margin_irrigation > 0 and margin_irrigation < 1),
  formula_tolerance numeric not null default 0.15 check (formula_tolerance > 0 and formula_tolerance <= 0.5),
  speed_target_hours numeric not null default 2 check (speed_target_hours > 0 and speed_target_hours <= 72),
  overdue_exceptions boolean not null default true,
  overdue_started_at timestamptz,
  offer_options boolean not null default false,
  mhic_license text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table public.sales_autopilot_settings enable row level security;
drop policy if exists sales_autopilot_settings_own_org on public.sales_autopilot_settings;
create policy sales_autopilot_settings_own_org on public.sales_autopilot_settings
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- 2 ------------------------------------------------------------------------
create table if not exists public.proposal_guardrail_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  -- The draft this check is about: a regenerated proposal is a new draft.
  generated_at timestamptz not null,
  passed boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  division text,
  margin_pct numeric,
  deviation_pct numeric,
  price_cents integer,
  formula_cents integer,
  -- What the autopilot did: ignore, hold, approve, approve_and_send.
  action text not null,
  action_note text,
  checked_at timestamptz not null default now(),
  -- When the client got it because of the autopilot.
  sent_at timestamptz,
  unique (job_id, generated_at)
);
create index if not exists proposal_guardrail_checks_org_idx on public.proposal_guardrail_checks (organization_id, checked_at desc);
alter table public.proposal_guardrail_checks enable row level security;
drop policy if exists proposal_guardrail_checks_own_org on public.proposal_guardrail_checks;
create policy proposal_guardrail_checks_own_org on public.proposal_guardrail_checks
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- 3 ------------------------------------------------------------------------
create table if not exists public.sales_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  kind text not null check (kind in ('proposal_overdue', 'price_held')),
  -- Who it is for. Null: the office (owner or account manager).
  assigned_to uuid references profiles(id) on delete set null,
  summary text not null check (length(btrim(summary)) > 0),
  detail text,
  state text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  dedupe_key text not null,
  opened_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  resolution text,
  unique (organization_id, dedupe_key)
);
create index if not exists sales_exceptions_open_idx on public.sales_exceptions (organization_id, state, opened_at desc);
create index if not exists sales_exceptions_job_idx on public.sales_exceptions (job_id);
alter table public.sales_exceptions enable row level security;
drop policy if exists sales_exceptions_own_org on public.sales_exceptions;
create policy sales_exceptions_own_org on public.sales_exceptions
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- 4 ------------------------------------------------------------------------
create table if not exists public.evaluator_territories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  evaluator_id uuid not null references profiles(id) on delete cascade,
  name text,
  zips text[] not null default '{}',
  -- Drawn areas: an array of rings, each [[lng, lat], ...], as GeoJSON orders them.
  areas jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  unique (organization_id, evaluator_id)
);
alter table public.evaluator_territories enable row level security;
drop policy if exists evaluator_territories_own_org on public.evaluator_territories;
create policy evaluator_territories_own_org on public.evaluator_territories
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- 5 ------------------------------------------------------------------------
alter table public.services add column if not exists merged_into text;
alter table public.services add column if not exists merged_at timestamptz;
-- Widened, not narrowed: every status allowed before is still allowed.
alter table public.services drop constraint if exists services_status_check;
alter table public.services add constraint services_status_check
  check (status in ('active', 'pending', 'denied', 'merged'));

-- 6 ------------------------------------------------------------------------
-- Folds p_from into p_into for the caller's own business. Security invoker:
-- it can only touch rows the caller's row security already lets them write.
-- Every reference is re-pointed; a reference that would duplicate one the
-- target already has (the same job asking for both) is left on the merged
-- service rather than deleted, and the merged service row is kept so old
-- proposals that name it still read.
create or replace function public.merge_services(p_from text, p_into text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid := current_org_id();
  src services%rowtype;
  dst services%rowtype;
  n_requested integer := 0;
  n_tools integer := 0;
  n_materials integer := 0;
  n_options integer := 0;
  n_designs integer := 0;
  n_plans integer := 0;
begin
  if org is null then raise exception 'Sign in first.'; end if;
  if p_from = p_into then raise exception 'That is the same service.'; end if;
  select * into src from services where organization_id = org and service_type_id = p_from for update;
  select * into dst from services where organization_id = org and service_type_id = p_into for update;
  if src.service_type_id is null or dst.service_type_id is null then raise exception 'One of those services no longer exists.'; end if;
  if src.status = 'merged' then raise exception 'That service was already merged.'; end if;
  if dst.status <> 'active' then raise exception 'Only an active service can be merged into.'; end if;

  update job_requested_services r set service_type_id = p_into
   where r.organization_id = org and r.service_type_id = p_from
     and not exists (select 1 from job_requested_services x where x.job_id = r.job_id and x.service_type_id = p_into);
  get diagnostics n_requested = row_count;

  update service_tools t set service_type_id = p_into
   where t.service_type_id = p_from
     and not exists (select 1 from service_tools x where x.tool_id = t.tool_id and x.service_type_id = p_into);
  get diagnostics n_tools = row_count;

  update service_materials m set service_type_id = p_into
   where m.service_type_id = p_from;
  get diagnostics n_materials = row_count;

  update custom_field_options o set service_type_id = p_into
   where o.organization_id = org and o.service_type_id = p_from
     and not exists (
       select 1 from custom_field_options x
        where x.organization_id = org and x.service_type_id = p_into and x.field_key = o.field_key and x.value = o.value
     );
  get diagnostics n_options = row_count;

  -- Site maps: each area's service.typeId.
  update canvas_designs d
     set zones = (
       select coalesce(jsonb_agg(
         case when z #>> '{service,typeId}' = p_from then jsonb_set(z, '{service,typeId}', to_jsonb(p_into)) else z end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(d.zones) with ordinality as e(z, ord)
     )
   where jsonb_typeof(d.zones) = 'array'
     and exists (select 1 from jsonb_array_elements(d.zones) z where z #>> '{service,typeId}' = p_from)
     and exists (select 1 from jobs j join properties p on p.id = j.property_id join customers c on c.id = p.customer_id
                  where j.id = d.job_id and c.organization_id = org);
  get diagnostics n_designs = row_count;

  -- Evaluation plans: [{..., typeId}].
  update jobs j
     set evaluation_plan = (
       select coalesce(jsonb_agg(
         case when e ->> 'typeId' = p_from then jsonb_set(e, '{typeId}', to_jsonb(p_into)) else e end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(j.evaluation_plan) with ordinality as x(e, ord)
     )
   where jsonb_typeof(j.evaluation_plan) = 'array'
     and exists (select 1 from jsonb_array_elements(j.evaluation_plan) e where e ->> 'typeId' = p_from)
     and exists (select 1 from properties p join customers c on c.id = p.customer_id where p.id = j.property_id and c.organization_id = org);
  get diagnostics n_plans = row_count;

  -- The rate carries over when the one kept has none.
  update services set
    cost = coalesce(dst.cost, src.cost),
    cogs = coalesce(dst.cogs, src.cogs),
    estimated_hours = coalesce(dst.estimated_hours, src.estimated_hours),
    minutes_per_sqft = coalesce(dst.minutes_per_sqft, src.minutes_per_sqft),
    scope_template = coalesce(dst.scope_template, src.scope_template),
    how_to = coalesce(dst.how_to, src.how_to)
   where organization_id = org and service_type_id = p_into;

  update services set status = 'merged', merged_into = p_into, merged_at = now()
   where organization_id = org and service_type_id = p_from;

  return jsonb_build_object(
    'requested', n_requested, 'tools', n_tools, 'materials', n_materials,
    'options', n_options, 'siteMaps', n_designs, 'plans', n_plans
  );
end;
$$;
revoke all on function public.merge_services(text, text) from public;
grant execute on function public.merge_services(text, text) to authenticated;
