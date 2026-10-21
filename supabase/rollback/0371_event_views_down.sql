-- Undo 0371_event_views.sql. Views only, so nothing is lost.
drop view if exists public.outbox_dead_letters;
drop view if exists public.action_required_items;
drop view if exists public.job_workflow_stage;
