-- Two reads over what already exists: where each job is in its life, as one
-- number, and everything that is waiting on a person, as one list.
--
-- Both are views, worked out every time they are asked, for the same reason
-- the job stage in the app is: a stored stage is one more thing to keep in
-- step, and it starts lying the first time somebody changes a status without
-- touching it. security_invoker makes each view read through the caller's own
-- row security, so nobody sees another business's jobs through it.
--
-- Views only. The rollback is supabase/rollback/0371_event_views_down.sql.

-- ---------------------------------------------------------------------------
-- The stage, as a code
-- ---------------------------------------------------------------------------
--   0 new lead                 no evaluation booked
--   1 appointment scheduled    an evaluation is booked and has not happened
--   2 estimate preparation     the evaluation happened, or a price is out
--   3 approved, awaiting work  sold
--   4 job in progress
--   6 awaiting payment         finished, not paid in full
--   7 closed                   finished and paid in full
--   8 cancelled
-- 5 (inspection) is not produced yet: the app has no inspection state on the
-- job row to read it from. The code is reserved so the numbers match the spec.
-- The lifecycle is a summary. Materials, crew and money run in parallel and
-- are read from their own records, never from this number.
create or replace view public.job_workflow_stage
with (security_invoker = true)
as
select
  j.id as job_id,
  j.organization_id,
  case
    when j.status = 'cancelled' then 8
    when j.status = 'completed' and public.job_paid_in_full(j.id) then 7
    when j.status = 'completed' then 6
    when j.status = 'in_progress' then 4
    when j.status = 'approved' then 3
    when j.status = 'quoted' then 2
    when j.evaluation_status = 'completed' then 2
    when j.evaluation_date is not null and j.evaluation_status in ('scheduled', 'on_way', 'arrived') then 1
    else 0
  end as stage_code,
  j.status as job_status,
  j.evaluation_status
from public.jobs j;

-- ---------------------------------------------------------------------------
-- Everything waiting on a person
-- ---------------------------------------------------------------------------
-- One row per open item, from every place the app keeps them. A job needs a
-- person when it has a row here; nothing is hidden because some other number
-- looks fine.
create or replace view public.action_required_items
with (security_invoker = true)
as
select 'job_issue'::text as source, i.id, i.organization_id, i.job_id,
       i.title as summary, i.severity, i.owner_id as owner_id, i.due_at, i.created_at,
       i.blocking
from public.job_issues i
where i.status = 'open'
union all
select 'job_exception', e.id, e.organization_id, e.job_id,
       e.summary, case when e.blocks_work then 'blocking' else 'warning' end, null::uuid, null::timestamptz, e.reported_at,
       e.blocks_work
from public.job_exceptions e
where e.state in ('reported', 'acknowledged')
union all
select 'sales_exception', s.id, s.organization_id, s.job_id,
       s.summary, 'warning', s.assigned_to, null::timestamptz, s.opened_at,
       false
from public.sales_exceptions s
where s.state = 'open'
union all
select 'client_automation_exception', c.id, c.organization_id, c.job_id,
       c.summary, 'warning', null::uuid, null::timestamptz, c.created_at,
       false
from public.client_automation_exceptions c
where c.state = 'open'
union all
select 'outbound_approval', o.id, o.organization_id, o.job_id,
       o.subject, 'info', null::uuid, o.expires_at, o.created_at,
       false
from public.outbound_approvals o
where o.status = 'pending'
union all
select 'automation_action', a.id, a.organization_id, a.job_id,
       a.action_type || ': ' || coalesce(a.last_error, a.reason, 'needs a person'),
       case when a.status = 'dead' then 'critical' else 'info' end,
       null::uuid, a.deadline_at, a.created_at,
       false
from public.automation_actions a
where a.status in ('dead', 'awaiting_approval')
union all
select 'workflow_task', t.id, t.organization_id, t.job_id,
       t.title, case when t.escalated_at is not null then 'critical' when t.blocking then 'blocking' else 'info' end,
       t.owner_profile_id, t.due_at, t.created_at,
       t.blocking
from public.workflow_tasks t
where t.state = 'open';

-- A dead delivery is a fact nobody acted on. It belongs on the list too, but
-- it names an event rather than a job, so it is its own small read.
create or replace view public.outbox_dead_letters
with (security_invoker = true)
as
select m.id, m.organization_id, m.consumer, m.attempts, m.last_error, m.created_at,
       e.event_type, e.entity_type, e.entity_id
from public.outbox_messages m
join public.domain_events e on e.event_id = m.event_id
where m.status = 'dead';
