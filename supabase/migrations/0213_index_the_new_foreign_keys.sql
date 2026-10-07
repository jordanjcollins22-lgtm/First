-- Covering indexes for the foreign keys added in 0208 and 0209.
--
-- Not for the reads: these tables are small and every read of them is already
-- by job. It is for the deletes. An unindexed foreign key means removing one
-- organisation, job or work session scans the whole child table to find what
-- to cascade, and the tables that hurt most are the ones that grow fastest --
-- the audit log and the progress rows.
--
-- The database linter reports all twelve at INFO; they are cheap, so all
-- twelve are covered rather than the four that would show up first.

CREATE INDEX IF NOT EXISTS job_exceptions_issue_idx ON public.job_exceptions (issue_id);
CREATE INDEX IF NOT EXISTS job_exceptions_scope_change_idx ON public.job_exceptions (scope_change_id);
CREATE INDEX IF NOT EXISTS job_exceptions_session_idx ON public.job_exceptions (work_session_id);

CREATE INDEX IF NOT EXISTS job_scope_changes_exception_idx ON public.job_scope_changes (exception_id);
CREATE INDEX IF NOT EXISTS job_scope_changes_supersedes_idx ON public.job_scope_changes (supersedes_id);

CREATE INDEX IF NOT EXISTS job_work_progress_org_idx ON public.job_work_progress (organization_id);
CREATE INDEX IF NOT EXISTS job_work_progress_exception_idx ON public.job_work_progress (exception_id);
CREATE INDEX IF NOT EXISTS job_work_progress_session_idx ON public.job_work_progress (work_session_id);

CREATE INDEX IF NOT EXISTS job_crew_assignments_org_idx ON public.job_crew_assignments (organization_id);
CREATE INDEX IF NOT EXISTS job_crew_assignments_exception_idx ON public.job_crew_assignments (exception_id);

CREATE INDEX IF NOT EXISTS job_audit_events_org_idx ON public.job_audit_events (organization_id);

CREATE INDEX IF NOT EXISTS owner_interventions_job_idx ON public.owner_interventions (job_id);
