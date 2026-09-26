-- One way to say something is wrong, and a record of every exception made.
--
-- Before this there was a callback panel, a dispute record, a completion note
-- and a message thread, and a material shortage was told to somebody rather
-- than written anywhere. Four systems for one idea, and no screen that could
-- answer "what is stuck".
--
-- job_issues is that one record. It hangs off the job, says what kind of
-- problem it is and how bad, and -- the part that matters -- whether it stops
-- the job. Blocking is its own column rather than being read off the severity,
-- because a manager can decide a critical-looking thing does not actually stop
-- the work, or that a warning does, and the row then shows they decided it.
--
-- job_gate_overrides is the other half. A failed check is never turned into a
-- passed one: real work needs exceptions -- the client rang and said use the
-- side gate -- so an override sits beside the failed check and stops it
-- stopping the job. Who, when, why, and which check. The check still reads as
-- failed, which is the true thing three weeks later.
--
-- Both are scoped by organisation and by row-level security, and neither is
-- reachable without a login: an issue names a client's property.

CREATE TABLE IF NOT EXISTS public.job_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  customer_id UUID,
  property_id UUID,
  type TEXT NOT NULL CHECK (type IN (
    'scope','client_change','scheduling','weather','material','equipment','crew',
    'access','safety','damage','quality','payment','complaint','other')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','blocking','critical')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  owner_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  -- Its own column, not read off the severity: see the note above.
  blocking BOOLEAN NOT NULL DEFAULT false,
  blocking_stage TEXT CHECK (blocking_stage IN ('proposal','booking','ready','start','closeout','completed')),
  resolution TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_issues_job_idx ON public.job_issues (job_id, status);
CREATE INDEX IF NOT EXISTS job_issues_open_idx ON public.job_issues (organization_id, status, blocking);

CREATE TABLE IF NOT EXISTS public.job_gate_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  gate TEXT NOT NULL CHECK (gate IN ('proposal','booking','ready','start','closeout','completed')),
  check_key TEXT NOT NULL,
  -- Never null and never blank: an override with no reason is the silent
  -- state change this table exists to prevent.
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  overridden_by UUID,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lifted again when the real condition is met, kept for the record.
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by UUID,
  UNIQUE (job_id, gate, check_key)
);
CREATE INDEX IF NOT EXISTS job_gate_overrides_job_idx ON public.job_gate_overrides (job_id, gate);

ALTER TABLE public.job_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_gate_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_issues_own_org ON public.job_issues;
CREATE POLICY job_issues_own_org ON public.job_issues FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS job_gate_overrides_own_org ON public.job_gate_overrides;
CREATE POLICY job_gate_overrides_own_org ON public.job_gate_overrides FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- What a job is waiting on, for the board: one row per job with anything
-- open, so Needs attention is a read rather than a stored status somebody
-- forgets to change back.
CREATE OR REPLACE FUNCTION public.jobs_needing_attention(org UUID)
RETURNS TABLE(job_id UUID, open_issues INTEGER, blocking_issues INTEGER, worst TEXT)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT i.job_id,
         count(*)::int,
         count(*) FILTER (WHERE i.blocking)::int,
         min(CASE i.severity WHEN 'critical' THEN 1 WHEN 'blocking' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END)::text
  FROM job_issues i
  WHERE i.organization_id = org AND i.status = 'open'
  GROUP BY i.job_id
  HAVING count(*) FILTER (WHERE i.blocking OR i.severity = 'critical') > 0;
$fn$;

NOTIFY pgrst, 'reload schema';
