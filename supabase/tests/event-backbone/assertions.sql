-- What 0370 and 0371 promise, checked against a throwaway database.
-- Each block raises on the first thing that is not true.

insert into organizations (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'JS Landscaping'),
  ('00000000-0000-0000-0000-00000000000b', 'Somebody else');
insert into profiles (id, organization_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b');

-- The same fact twice is one event, with one set of deliveries.
do $$
declare
  first record;
  second record;
  n int;
begin
  select * into first from record_domain_event(
    '00000000-0000-0000-0000-00000000000a', 'estimate.approved', 'job_proposal',
    '00000000-0000-0000-0000-000000000101', now(), 'customer', null, 'proposal_page',
    null, null, 1, 'estimate.approved:p101', '{"total_cents": 120000}', array['workflow', 'followups']);
  select * into second from record_domain_event(
    '00000000-0000-0000-0000-00000000000a', 'estimate.approved', 'job_proposal',
    '00000000-0000-0000-0000-000000000101', now(), 'customer', null, 'proposal_page',
    null, null, 1, 'estimate.approved:p101', '{"total_cents": 120000}', array['workflow', 'followups']);
  if not first.inserted then raise exception 'first record should insert'; end if;
  if second.inserted then raise exception 'replay should not insert'; end if;
  if first.event_id <> second.event_id then raise exception 'replay should return the first event'; end if;
  select count(*) into n from outbox_messages where event_id = first.event_id;
  if n <> 2 then raise exception 'expected 2 deliveries, got %', n; end if;
  select count(*) into n from domain_events where idempotency_key = 'estimate.approved:p101';
  if n <> 1 then raise exception 'expected 1 event, got %', n; end if;
  -- With no correlation given, an event starts its own chain.
  if (select correlation_id from domain_events where event_id = first.event_id) <> first.event_id then
    raise exception 'a first event should correlate to itself';
  end if;
end $$;

-- The same key in another business is a different fact.
do $$
declare r record;
begin
  select * into r from record_domain_event(
    '00000000-0000-0000-0000-00000000000b', 'estimate.approved', 'job_proposal',
    '00000000-0000-0000-0000-000000000101', now(), 'customer', null, 'proposal_page',
    null, null, 1, 'estimate.approved:p101', '{}', array['workflow']);
  if not r.inserted then raise exception 'idempotency keys are per business'; end if;
end $$;

-- Facts are never edited.
do $$
begin
  begin
    update domain_events set payload = '{}' where idempotency_key = 'estimate.approved:p101';
    raise exception 'update should have been refused';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from domain_events where idempotency_key = 'estimate.approved:p101';
    raise exception 'delete should have been refused';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- A claimed delivery is not claimed again until its lease runs out.
do $$
declare n int;
begin
  select count(*) into n from claim_outbox_batch('workflow', 10, 120);
  if n <> 2 then raise exception 'expected 2 workflow deliveries (one per business), got %', n; end if;
  select count(*) into n from claim_outbox_batch('workflow', 10, 120);
  if n <> 0 then raise exception 'a leased delivery was claimed twice (% rows)', n; end if;
  -- The worker died: the lease lapses and the row comes back.
  update outbox_messages set locked_until = now() - interval '1 second' where consumer = 'workflow';
  select count(*) into n from claim_outbox_batch('workflow', 10, 120);
  if n <> 2 then raise exception 'an expired lease should be claimable, got %', n; end if;
  if (select max(attempts) from outbox_messages where consumer = 'workflow') <> 2 then
    raise exception 'attempts should count each claim';
  end if;
  -- Not due yet: not claimed.
  update outbox_messages set status = 'failed', locked_until = null, next_attempt_at = now() + interval '1 hour' where consumer = 'followups';
  select count(*) into n from claim_outbox_batch('followups', 10, 120);
  if n <> 0 then raise exception 'a delivery not yet due was claimed'; end if;
end $$;

-- One task and one action per dedupe key.
do $$
begin
  insert into workflow_tasks (organization_id, kind, title, dedupe_key) values
    ('00000000-0000-0000-0000-00000000000a', 'schedule_job', 'Book the job', 'schedule:j1');
  begin
    insert into workflow_tasks (organization_id, kind, title, dedupe_key) values
      ('00000000-0000-0000-0000-00000000000a', 'schedule_job', 'Book the job', 'schedule:j1');
    raise exception 'a second task with the same key was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into workflow_tasks (organization_id, kind, title, dedupe_key, state) values
      ('00000000-0000-0000-0000-00000000000a', 'schedule_job', 'Closed with no time', 'schedule:j2', 'done');
    raise exception 'a closed task with no resolved_at was accepted';
  exception when check_violation then null;
  end;
end $$;

-- The stage codes.
insert into jobs (id, organization_id, status, evaluation_status, evaluation_date) values
  ('00000000-0000-0000-0000-000000000c00', '00000000-0000-0000-0000-00000000000a', 'estimating', 'scheduled', null),
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000000a', 'estimating', 'scheduled', current_date + 2),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-00000000000a', 'estimating', 'completed', current_date - 1),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-00000000000a', 'approved', 'completed', current_date - 9),
  ('00000000-0000-0000-0000-000000000c04', '00000000-0000-0000-0000-00000000000a', 'in_progress', 'completed', current_date - 9),
  ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-00000000000a', 'completed', 'completed', current_date - 9),
  ('00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-00000000000a', 'completed', 'completed', current_date - 9),
  ('00000000-0000-0000-0000-000000000c08', '00000000-0000-0000-0000-00000000000a', 'cancelled', 'cancelled', null);
insert into job_proposals (job_id, status, paid_at) values ('00000000-0000-0000-0000-000000000c07', 'paid', now());
do $$
declare got text;
begin
  select string_agg(stage_code::text, ',' order by job_id) into got from job_workflow_stage;
  if got <> '0,1,2,3,4,6,7,8' then raise exception 'stage codes were %', got; end if;
end $$;

-- Everything waiting on a person, from every source.
insert into job_issues (organization_id, job_id, title, severity, blocking) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000c03', 'Mulch not confirmed', 'blocking', true);
insert into job_issues (organization_id, job_id, title, severity, status) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000c03', 'Old', 'info', 'resolved');
insert into job_exceptions (organization_id, job_id, summary) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000c04', 'Gate locked');
insert into sales_exceptions (organization_id, job_id, summary) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000c02', 'Proposal overdue');
insert into client_automation_exceptions (organization_id, job_id, summary) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000c06', 'Unpaid 30 days');
insert into outbound_approvals (organization_id, job_id, subject) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000c01', 'Your visit tomorrow');
insert into automation_actions (organization_id, rule_id, rule_version, action_type, entity_type, entity_id, dedupe_key, mode, status, desired_outcome, last_error)
  values ('00000000-0000-0000-0000-00000000000a', 'proposal_followup', 1, 'send_followup', 'job_proposal', gen_random_uuid(), 'f:1', 'approval_required', 'dead', 'Client answers', 'provider down');
do $$
declare got text;
begin
  select string_agg(source, ',' order by source) into got from action_required_items;
  if got <> 'automation_action,client_automation_exception,job_exception,job_issue,outbound_approval,sales_exception,workflow_task' then
    raise exception 'action_required_items had %', got;
  end if;
end $$;

-- Row security: a person sees their own business only, and cannot write facts.
grant select, update on all tables in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare n int;
begin
  select count(*) into n from domain_events;
  if n <> 1 then raise exception 'business B should see 1 event, saw %', n; end if;
  select count(*) into n from workflow_tasks;
  if n <> 0 then raise exception 'business B saw business A tasks'; end if;
  select count(*) into n from job_workflow_stage;
  if n <> 0 then raise exception 'the stage view leaked another business''s jobs (% rows)', n; end if;
  begin
    perform record_domain_event('00000000-0000-0000-0000-00000000000b', 'lead.created', 'job', gen_random_uuid(), now(),
      'profile', null, 'test', null, null, 1, 'x', '{}', array[]::text[]);
    raise exception 'a signed-in person could call record_domain_event';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
