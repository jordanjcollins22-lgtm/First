-- The event backbone: what happened, who still has to hear about it, and
-- what the automations decided to do about it.
--
-- Until now every automation has been its own cron with its own dedupe
-- table. That works, and it is why nothing has double-texted anybody, but it
-- leaves no single answer to "what happened to this job, in what order, and
-- what did the machine do about each thing". This adds that answer, beside
-- everything that exists rather than instead of it.
--
-- Five ideas, and the boundaries between them are the point.
--
-- 1. domain_events is the record of facts. Append-only: a fact that turns out
--    wrong is answered by a later fact, never edited. Every event carries the
--    chain it belongs to (correlation_id) and the event that caused it
--    (causation_id), and an idempotency key, so the same fact reported twice
--    -- a webhook retried, a button tapped twice -- is one row.
--
-- 2. outbox_messages is who still has to hear about each fact. Written in the
--    same transaction as the event (record_domain_event below), so an event
--    can never exist without its deliveries or the other way round. A worker
--    claims rows with skip locked, so two runs at once never take the same
--    one, and a row whose worker died is taken again when its lease runs out.
--    Delivery is at least once: every consumer must be idempotent.
--
-- 3. automation_actions is what an automation decided to do, and what it
--    then saw. Asking a provider to send a text is not the client getting it,
--    and the client getting it is not the client answering, so send_status
--    and observed_status are separate columns. One row per dedupe key.
--
-- 4. workflow_tasks is the work a person has to do because of a fact: book
--    this job, confirm the materials, write the estimate. One open row per
--    dedupe key, so a replayed event finds the task it already made.
--
-- 5. automation_controls is the switch. Everything here starts off and in
--    dry-run for every business: recording events, and deciding what would
--    be done, change nothing a client or a crew sees until the owner says so.
--
-- Additive only. Nothing here changes or removes an existing row, column or
-- constraint. The rollback is supabase/rollback/0370_event_backbone_down.sql.

-- ---------------------------------------------------------------------------
-- 1. Facts
-- ---------------------------------------------------------------------------
create table if not exists public.domain_events (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id uuid not null,
  -- When it happened in the world, and when we heard. A webhook can arrive
  -- hours late; ordering by the first keeps a late report from looking new.
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('customer', 'profile', 'system', 'integration')),
  actor_id text,
  source text not null check (length(btrim(source)) > 0),
  correlation_id uuid not null,
  causation_id uuid references public.domain_events(event_id) on delete set null,
  schema_version integer not null default 1 check (schema_version > 0),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  payload jsonb not null default '{}'::jsonb,
  unique (organization_id, idempotency_key)
);
create index if not exists domain_events_entity_idx
  on public.domain_events (organization_id, entity_type, entity_id, occurred_at);
create index if not exists domain_events_type_idx
  on public.domain_events (organization_id, event_type, recorded_at desc);
create index if not exists domain_events_correlation_idx
  on public.domain_events (correlation_id);

-- Append-only, held by the database rather than by everybody remembering.
create or replace function public.domain_events_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'domain_events is append-only: record a new event instead of changing %', old.event_id;
end;
$$;
drop trigger if exists domain_events_no_update on public.domain_events;
create trigger domain_events_no_update before update or delete on public.domain_events
  for each row execute function public.domain_events_append_only();

-- ---------------------------------------------------------------------------
-- 2. Deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.domain_events(event_id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  consumer text not null check (length(btrim(consumer)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, consumer)
);
create index if not exists outbox_messages_due_idx
  on public.outbox_messages (consumer, next_attempt_at)
  where status in ('pending', 'failed', 'processing');
create index if not exists outbox_messages_dead_idx
  on public.outbox_messages (organization_id, created_at desc)
  where status = 'dead';

-- ---------------------------------------------------------------------------
-- 3. Rules, as the owner has changed them
-- ---------------------------------------------------------------------------
-- A rule with no row follows its built-in default in code (src/lib/os/rules),
-- the same arrangement email_approval_policy has, so a new rule never needs a
-- migration. A row is a business changing the mode or the numbers.
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null check (rule_id ~ '^[a-z0-9_]+$'),
  version integer not null check (version > 0),
  mode text not null default 'approval_required'
    check (mode in ('auto_allowed', 'approval_required', 'human_only', 'paused')),
  params jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, rule_id, version)
);

-- ---------------------------------------------------------------------------
-- 4. What the automations decided, and what they saw afterwards
-- ---------------------------------------------------------------------------
create table if not exists public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null,
  rule_version integer not null,
  action_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  job_id uuid references public.jobs(id) on delete cascade,
  dedupe_key text not null check (length(btrim(dedupe_key)) > 0),
  mode text not null check (mode in ('auto_allowed', 'approval_required', 'human_only', 'paused')),
  dry_run boolean not null default true,
  -- scheduled: waiting for its moment. proposed: decided, and in dry-run (or
  -- waiting for approval) so nothing went out. skipped: its conditions said
  -- no, and reason says which. dead: retries ran out; a person looks.
  status text not null default 'scheduled'
    check (status in ('scheduled', 'proposed', 'awaiting_approval', 'queued', 'sent', 'skipped', 'failed', 'dead', 'cancelled', 'done')),
  -- What the provider said about the send, kept apart from what the client did.
  send_status text check (send_status in ('accepted', 'delivered', 'undelivered', 'unknown')),
  observed_status text check (observed_status in ('responded', 'no_response', 'confirmed', 'settled')),
  desired_outcome text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  deadline_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts > 0),
  provider_ref text,
  last_error text,
  caused_by_event uuid references public.domain_events(event_id) on delete set null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index if not exists automation_actions_due_idx
  on public.automation_actions (organization_id, due_at)
  where status = 'scheduled';
create index if not exists automation_actions_job_idx
  on public.automation_actions (job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Work for a person
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_:-]+$'),
  title text not null check (length(btrim(title)) > 0),
  detail text,
  -- A blocking task is something that stops the job moving on; the rest are
  -- reminders that something is waiting.
  blocking boolean not null default false,
  state text not null default 'open' check (state in ('open', 'done', 'cancelled')),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  escalated_at timestamptz,
  dedupe_key text not null check (length(btrim(dedupe_key)) > 0),
  source_event uuid references public.domain_events(event_id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text,
  unique (organization_id, dedupe_key),
  constraint workflow_tasks_closed_says_when check (state = 'open' or resolved_at is not null)
);
create index if not exists workflow_tasks_open_idx
  on public.workflow_tasks (organization_id, due_at)
  where state = 'open';
create index if not exists workflow_tasks_job_idx on public.workflow_tasks (job_id);

-- ---------------------------------------------------------------------------
-- 6. Every decision a rule made, with what it was looking at
-- ---------------------------------------------------------------------------
create table if not exists public.automation_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null,
  rule_version integer not null,
  event_id uuid references public.domain_events(event_id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  decision text not null,
  inputs jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists automation_audit_entity_idx
  on public.automation_audit (organization_id, entity_type, entity_id, at desc);

-- ---------------------------------------------------------------------------
-- 7. The switch
-- ---------------------------------------------------------------------------
-- No row means off. events_enabled lets facts be recorded; dry_run keeps
-- every decision on paper; paused stops even that, for when something looks
-- wrong and the owner wants it all to hold still.
create table if not exists public.automation_controls (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  events_enabled boolean not null default false,
  dry_run boolean not null default true,
  paused boolean not null default false,
  paused_reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Writing an event: the event and its deliveries in one transaction
-- ---------------------------------------------------------------------------
-- The same idempotency key twice returns the first event and inserted =
-- false, and adds no deliveries. The supabase client cannot hold a
-- transaction open across two calls, which is why this is a function.
create or replace function public.record_domain_event(
  p_organization_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_occurred_at timestamptz,
  p_actor_type text,
  p_actor_id text,
  p_source text,
  p_correlation_id uuid,
  p_causation_id uuid,
  p_schema_version integer,
  p_idempotency_key text,
  p_payload jsonb,
  p_consumers text[]
)
returns table (event_id uuid, inserted boolean)
language plpgsql
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  got uuid;
begin
  insert into public.domain_events (
    event_id, organization_id, event_type, entity_type, entity_id, occurred_at,
    actor_type, actor_id, source, correlation_id, causation_id, schema_version,
    idempotency_key, payload
  ) values (
    new_id, p_organization_id, p_event_type, p_entity_type, p_entity_id, p_occurred_at,
    p_actor_type, p_actor_id, p_source, coalesce(p_correlation_id, new_id), p_causation_id,
    coalesce(p_schema_version, 1), p_idempotency_key, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning domain_events.event_id into got;

  if got is null then
    select e.event_id into got
    from public.domain_events e
    where e.organization_id = p_organization_id and e.idempotency_key = p_idempotency_key;
    return query select got, false;
    return;
  end if;

  insert into public.outbox_messages (event_id, organization_id, consumer)
  select got, p_organization_id, c
  from unnest(coalesce(p_consumers, array[]::text[])) as c
  on conflict on constraint outbox_messages_event_id_consumer_key do nothing;

  return query select got, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming work: skip locked, with a lease that a dead worker gives back
-- ---------------------------------------------------------------------------
create or replace function public.claim_outbox_batch(
  p_consumer text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.outbox_messages
language sql
set search_path = public
as $$
  update public.outbox_messages m
  set status = 'processing',
      attempts = m.attempts + 1,
      locked_until = now() + make_interval(secs => p_lease_seconds)
  where m.id in (
    select o.id
    from public.outbox_messages o
    where o.consumer = p_consumer
      and o.next_attempt_at <= now()
      and (
        o.status in ('pending', 'failed')
        or (o.status = 'processing' and o.locked_until < now())
      )
    order by o.next_attempt_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  )
  returning m.*;
$$;

-- Only the server, with the service key, writes facts or claims work.
revoke all on function public.record_domain_event(uuid, text, text, uuid, timestamptz, text, text, text, uuid, uuid, integer, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.claim_outbox_batch(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row security: people in the business read; the server writes
-- ---------------------------------------------------------------------------
alter table public.domain_events enable row level security;
alter table public.outbox_messages enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_actions enable row level security;
alter table public.workflow_tasks enable row level security;
alter table public.automation_audit enable row level security;
alter table public.automation_controls enable row level security;

-- Each business reads its own rows. Written out one by one, not in a loop,
-- so the policy coverage check can see every table has one.
drop policy if exists domain_events_org_read on public.domain_events;
create policy domain_events_org_read on public.domain_events
  for select to authenticated using (organization_id = (select current_org_id()));
drop policy if exists outbox_messages_org_read on public.outbox_messages;
create policy outbox_messages_org_read on public.outbox_messages
  for select to authenticated using (organization_id = (select current_org_id()));
drop policy if exists automation_rules_org_read on public.automation_rules;
create policy automation_rules_org_read on public.automation_rules
  for select to authenticated using (organization_id = (select current_org_id()));
drop policy if exists automation_actions_org_read on public.automation_actions;
create policy automation_actions_org_read on public.automation_actions
  for select to authenticated using (organization_id = (select current_org_id()));
drop policy if exists workflow_tasks_org_read on public.workflow_tasks;
create policy workflow_tasks_org_read on public.workflow_tasks
  for select to authenticated using (organization_id = (select current_org_id()));
drop policy if exists automation_audit_org_read on public.automation_audit;
create policy automation_audit_org_read on public.automation_audit
  for select to authenticated using (organization_id = (select current_org_id()));
drop policy if exists automation_controls_org_read on public.automation_controls;
create policy automation_controls_org_read on public.automation_controls
  for select to authenticated using (organization_id = (select current_org_id()));

-- A person closes a task they have dealt with. Nothing else is written from
-- a browser: the switch, the rules and the facts change through the server.
drop policy if exists workflow_tasks_org_resolve on public.workflow_tasks;
create policy workflow_tasks_org_resolve on public.workflow_tasks
  for update to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
