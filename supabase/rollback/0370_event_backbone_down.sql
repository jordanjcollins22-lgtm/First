-- Undo 0370_event_backbone.sql. Run 0371's rollback first.
--
-- This drops the event history and every automation decision with it. Turn
-- the backbone off instead (automation_controls.events_enabled = false, or
-- unset OS_EVENT_BACKBONE) unless the tables really have to go.
drop function if exists public.claim_outbox_batch(text, integer, integer);
drop function if exists public.record_domain_event(uuid, text, text, uuid, timestamptz, text, text, text, uuid, uuid, integer, text, jsonb, text[]);
drop table if exists public.automation_controls;
drop table if exists public.automation_audit;
drop table if exists public.workflow_tasks;
drop table if exists public.automation_actions;
drop table if exists public.automation_rules;
drop table if exists public.outbox_messages;
drop table if exists public.domain_events;
drop function if exists public.domain_events_append_only();
