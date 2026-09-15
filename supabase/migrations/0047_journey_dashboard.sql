-- Admin-only Journey Dashboard: maps how each role (or the client) moves
-- through the system step by step, so friction/bottlenecks can be spotted
-- and removed. Steps are DATA, not code — new roles, branches, and steps
-- are added by inserting rows, never by touching the app.
--
-- role_key is a free label ("client", "evaluator", "admin", ...) rather than
-- a foreign key into roles(name): the client journey isn't a real account
-- role at all, and different businesses may name their roles differently.

create table if not exists journeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  role_key text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, role_key)
);

drop trigger if exists set_updated_at on journeys;
create trigger set_updated_at before update on journeys for each row execute function set_updated_at();

create table if not exists journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys(id) on delete cascade,
  step_key text not null,
  order_index integer not null default 0,
  label text not null,
  -- HUMAN | AUTOMATED | HUMAN_APPROVAL | CUSTOMER_ACTION | SYSTEM_ACTION
  step_type text not null default 'human',
  role_label text,
  inputs text[] not null default '{}',
  outputs text[] not null default '{}',
  automations text[] not null default '{}',
  -- step_keys this can lead to — a step with >1 is a branch, several steps
  -- sharing a next_steps entry converge into it (e.g. every lead source
  -- converging into "lead_in_crm").
  next_steps text[] not null default '{}',
  clicks integer not null default 0,
  manual_inputs integer not null default 0,
  customer_comms integer not null default 0,
  internal_comms integer not null default 0,
  texts integer not null default 0,
  emails integer not null default 0,
  calls integer not null default 0,
  est_minutes numeric,
  -- false = this step is part of the intended journey but doesn't exist in
  -- the app yet — the dashboard's whole point is to surface these gaps.
  is_built boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, step_key)
);

drop trigger if exists set_updated_at on journey_steps;
create trigger set_updated_at before update on journey_steps for each row execute function set_updated_at();
alter table journey_steps drop constraint if exists journey_steps_step_type_check;
alter table journey_steps add constraint journey_steps_step_type_check
  check (step_type in ('human', 'automated', 'human_approval', 'customer_action', 'system_action'));

alter table journeys enable row level security;
drop policy if exists "admin_manage_journeys" on journeys;
create policy "admin_manage_journeys" on journeys for all to authenticated
  using (is_admin() and organization_id = current_org_id())
  with check (is_admin() and organization_id = current_org_id());

alter table journey_steps enable row level security;
drop policy if exists "admin_manage_journey_steps" on journey_steps;
create policy "admin_manage_journey_steps" on journey_steps for all to authenticated
  using (is_admin() and exists (
    select 1 from journeys j where j.id = journey_steps.journey_id and j.organization_id = current_org_id()
  ))
  with check (is_admin() and exists (
    select 1 from journeys j where j.id = journey_steps.journey_id and j.organization_id = current_org_id()
  ));

-- No seed data here — the Evaluator and Client journeys are defined in code
-- (src/lib/journeys/definitions.ts) and kept in sync with the real app by
-- syncCodeManagedJourneys(), called each time an admin opens the dashboard.
-- That way the journey always reflects the app as it exists right now,
-- instead of drifting from a one-time SQL snapshot.

