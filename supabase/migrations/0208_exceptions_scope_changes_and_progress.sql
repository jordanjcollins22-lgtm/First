-- What actually happens on a job, written down where somebody can act on it.
--
-- Everything in this file exists because of one observation: the work almost
-- never goes exactly as sold, and every time it does not, the business runs on
-- a phone call. The client comes out and asks for the other bed. The gate is
-- padlocked. The mower will not start. Two of the four zones get done and the
-- third is under six inches of standing water. Every one of those is currently
-- a text message to the owner, and the owner is the bottleneck.
--
-- So: a field person reports the exception, in the app, once. The thing it
-- needs -- a decision, a price, a client's yes -- is routed to whoever is
-- allowed to give it, and the job carries the record afterwards.
--
-- Four ideas, and the boundaries between them are the point.
--
-- 1. job_exceptions is the report. Thirteen kinds, one shape. It says what
--    happened, who saw it, and whether they can carry on. It is not a
--    judgement about the job -- job_issues is still the thing that says a job
--    is blocked, and an exception that blocks raises one and links to it.
--
-- 2. job_scope_changes is the only route by which the work a crew is asked to
--    do can grow. This is the important constraint in the whole file: a field
--    person can *report* that the client wants more, and that is all they can
--    do. They cannot price it, they cannot agree it, and nothing they write
--    touches the sold scope. An account manager reviews it, adds a price and
--    terms if there is a charge, the client says yes, and only then does it
--    become work the crew may do. The original scope is never edited -- the
--    executable scope is the sold scope *plus* the approved changes, so what
--    was sold in March is still readable in December.
--
-- 3. job_work_progress is partial completion. Three zones done, one not, and
--    the reason the fourth was not. Before this, a job was finished or it was
--    not, so a crew that did most of it had nowhere to say so and the
--    difference was carried in somebody's head to the invoice.
--
-- 4. job_audit_events is the history, for all of it, append-only. Not a
--    convenience: the reason a decision was made is worth more three months
--    later than the decision, and every one of these records is going to be
--    read back by somebody who was not there.
--
-- Nothing here deletes anything. A superseded price supersedes; a withdrawn
-- request is withdrawn; a crew member taken off a job leaves an assignment
-- that ended. The current state is always derivable and the history is always
-- there.

-- ---------------------------------------------------------------------------
-- 1. The report
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- The visit it happened on, when it happened on one. A change request
  -- phoned in on a Tuesday belongs to the job, not to a day of work.
  work_session_id UUID REFERENCES public.job_work_sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'change_request',        -- the client wants something that was not sold
    'cannot_perform',        -- the scoped work cannot be done as written
    'partial_completion',    -- the work stopped short of what was scoped
    'material_discrepancy',  -- what turned up is not what the job needs
    'equipment_failure',     -- it broke
    'equipment_unavailable', -- it never arrived, or somebody else has it
    'crew_absence',          -- somebody is not coming
    'late_start',
    'overrun',
    'weather_interruption',
    'access_failure',        -- locked gate, dog, nobody home, blocked drive
    'instruction_conflict',  -- the client on site contradicts the sold scope
    'cancellation'           -- called off, or nobody there at all
  )),
  state TEXT NOT NULL DEFAULT 'reported'
    CHECK (state IN ('reported','acknowledged','resolved','dismissed')),
  summary TEXT NOT NULL CHECK (length(btrim(summary)) > 0),
  detail TEXT,
  -- The field's own answer to "can you carry on". It is a report, not a
  -- verdict: whether the *job* is blocked is job_issues' business, and a lead
  -- saying they are stuck is exactly the input that should raise one.
  blocks_work BOOLEAN NOT NULL DEFAULT false,
  -- The issue this raised, when it raised one. Kept as a link rather than a
  -- copy so resolving one does not silently resolve the other.
  issue_id UUID REFERENCES public.job_issues(id) ON DELETE SET NULL,
  -- The change request this became, for kind = 'change_request'.
  scope_change_id UUID,
  reported_by UUID,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  resolution TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Closing one is a decision, and a decision with no reason is the silent
  -- state change the whole design is trying to avoid.
  CONSTRAINT job_exceptions_closed_says_why
    CHECK (state NOT IN ('resolved','dismissed') OR length(btrim(coalesce(resolution,''))) > 0)
);
CREATE INDEX IF NOT EXISTS job_exceptions_job_idx ON public.job_exceptions (job_id, state);
CREATE INDEX IF NOT EXISTS job_exceptions_open_idx
  ON public.job_exceptions (organization_id, state) WHERE state IN ('reported','acknowledged');

-- ---------------------------------------------------------------------------
-- 2. The only way the work can grow
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_scope_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  exception_id UUID REFERENCES public.job_exceptions(id) ON DELETE SET NULL,

  -- What the field reported. Prose, because a person standing in a garden
  -- describes a thing in words, and forcing them to pick a service type is how
  -- the report ends up wrong or does not get made.
  requested_by UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_note TEXT NOT NULL CHECK (length(btrim(requested_note)) > 0),
  -- Optional structure the account manager fills in: zones referenced,
  -- services proposed, quantities. Never authoritative on its own.
  proposed JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN (
    'reported',        -- the field has said it
    'in_review',       -- an account manager has picked it up
    'priced',          -- a number and terms exist
    'sent_to_client',
    'client_approved', -- and therefore executable
    'client_declined',
    'rejected',        -- the business said no before the client saw it
    'withdrawn',       -- the person who asked took it back
    'superseded'       -- replaced by a revised request
  )),

  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,

  -- Null price means no charge, which is a decision somebody made and not an
  -- absence: priced_at records that they made it.
  price_cents BIGINT CHECK (price_cents IS NULL OR price_cents >= 0),
  terms TEXT,
  priced_by UUID,
  priced_at TIMESTAMPTZ,

  -- Most changes need the client to say yes. A few genuinely do not -- the
  -- client is the one who asked, standing there, and it costs nothing -- and
  -- when an account manager decides that, they have to say why.
  client_approval_required BOOLEAN NOT NULL DEFAULT true,
  approval_waived_reason TEXT,
  sent_to_client_at TIMESTAMPTZ,
  client_decision TEXT CHECK (client_decision IS NULL OR client_decision IN ('approved','declined')),
  client_decision_at TIMESTAMPTZ,
  client_decision_note TEXT,
  -- How the yes arrived, and who wrote it down. A verbal yes is a real yes and
  -- is worth more when the record says it was verbal and who heard it.
  client_decision_channel TEXT CHECK (client_decision_channel IS NULL OR client_decision_channel IN
    ('portal','email','sms','phone','in_person','other')),
  client_decision_recorded_by UUID,

  -- Set when the crew may actually do it, and only then.
  executable_at TIMESTAMPTZ,

  supersedes_id UUID REFERENCES public.job_scope_changes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The shape of the pipeline, in the data rather than in a screen. A row
  -- cannot reach the client without having been reviewed, cannot be approved
  -- without a recorded decision, and cannot be executable unless it is
  -- approved. These are the guarantees the field constraint above depends on.
  CONSTRAINT scope_change_reviewed_before_client
    CHECK (status NOT IN ('sent_to_client','client_approved','client_declined') OR reviewed_at IS NOT NULL),
  CONSTRAINT scope_change_approved_has_decision
    CHECK (status <> 'client_approved' OR client_decision = 'approved' OR client_approval_required = false),
  CONSTRAINT scope_change_declined_has_decision
    CHECK (status <> 'client_declined' OR client_decision = 'declined'),
  CONSTRAINT scope_change_waiver_says_why
    CHECK (client_approval_required OR length(btrim(coalesce(approval_waived_reason,''))) > 0),
  CONSTRAINT scope_change_executable_only_when_approved
    CHECK (executable_at IS NULL OR status = 'client_approved'),
  CONSTRAINT scope_change_priced_has_pricer
    CHECK (priced_at IS NULL OR priced_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS job_scope_changes_job_idx ON public.job_scope_changes (job_id, status);
CREATE INDEX IF NOT EXISTS job_scope_changes_waiting_idx
  ON public.job_scope_changes (organization_id, status)
  WHERE status IN ('reported','in_review','priced','sent_to_client');

ALTER TABLE public.job_exceptions
  DROP CONSTRAINT IF EXISTS job_exceptions_scope_change_fk;
ALTER TABLE public.job_exceptions
  ADD CONSTRAINT job_exceptions_scope_change_fk
  FOREIGN KEY (scope_change_id) REFERENCES public.job_scope_changes(id) ON DELETE SET NULL;

-- Executable the moment the client says yes, and never before. Doing it in a
-- trigger rather than in the calling code means every path -- the portal, an
-- account manager recording a phone call, a backfill -- agrees.
CREATE OR REPLACE FUNCTION public.scope_change_stamp_executable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.status = 'client_approved' AND NEW.executable_at IS NULL THEN
    NEW.executable_at := COALESCE(NEW.client_decision_at, now());
  END IF;
  IF NEW.status <> 'client_approved' THEN
    NEW.executable_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS scope_change_executable ON public.job_scope_changes;
CREATE TRIGGER scope_change_executable BEFORE INSERT OR UPDATE ON public.job_scope_changes
  FOR EACH ROW EXECUTE FUNCTION public.scope_change_stamp_executable();

-- ---------------------------------------------------------------------------
-- 3. Partial completion
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_work_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- A zone from the site plan, a service on the job, or a named task from the
  -- work order. One table because the question is the same in all three cases:
  -- was this bit done, and if not, why not.
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('zone','service','task')),
  unit_key TEXT NOT NULL CHECK (length(btrim(unit_key)) > 0),
  unit_label TEXT,
  state TEXT NOT NULL DEFAULT 'not_started' CHECK (state IN (
    'not_started','in_progress','complete','partial','cannot_perform','skipped')),
  -- Roughly how much of it, where the crew can say. Never inferred, and never
  -- used as evidence of anything on its own.
  portion_pct INTEGER CHECK (portion_pct IS NULL OR (portion_pct >= 0 AND portion_pct <= 100)),
  note TEXT,
  exception_id UUID REFERENCES public.job_exceptions(id) ON DELETE SET NULL,
  work_session_id UUID REFERENCES public.job_work_sessions(id) ON DELETE SET NULL,
  recorded_by UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, unit_kind, unit_key),
  -- Anything short of done has to say why. This is the whole value of the
  -- table: "three of four zones" with no reason is not better than nothing,
  -- because the person reading it still has to ring somebody.
  CONSTRAINT job_work_progress_short_says_why
    CHECK (state NOT IN ('partial','cannot_perform','skipped') OR length(btrim(coalesce(note,''))) > 0)
);
CREATE INDEX IF NOT EXISTS job_work_progress_job_idx ON public.job_work_progress (job_id, state);

-- ---------------------------------------------------------------------------
-- 4. Who was on the job, including who used to be
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_crew_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('lead','technician')),
  assigned_by UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at TIMESTAMPTZ,
  unassigned_by UUID,
  unassign_reason TEXT,
  -- The person who took it over, when somebody did. This is what turns a list
  -- of comings and goings into "Dave called out and Marcus covered".
  replaced_by_profile_id UUID,
  exception_id UUID REFERENCES public.job_exceptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_crew_assignments_job_idx ON public.job_crew_assignments (job_id, unassigned_at);
CREATE INDEX IF NOT EXISTS job_crew_assignments_person_idx ON public.job_crew_assignments (profile_id, assigned_at DESC);

-- job_crew stays what it has always been: who is on the job right now. The
-- history is kept beside it by trigger rather than by asking every caller to
-- remember, so a path written two years ago still leaves a record.
CREATE OR REPLACE FUNCTION public.job_crew_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO job_crew_assignments (organization_id, job_id, profile_id, role, assigned_by, assigned_at)
    VALUES (NEW.organization_id, NEW.job_id, NEW.profile_id,
            CASE WHEN NEW.is_lead THEN 'lead' ELSE 'technician' END,
            NEW.added_by, COALESCE(NEW.created_at, now()));
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE job_crew_assignments
       SET unassigned_at = now()
     WHERE job_id = OLD.job_id AND profile_id = OLD.profile_id AND unassigned_at IS NULL;
    RETURN OLD;
  END IF;

  -- Promoted to lead, or stood down from it: close the old row and open a new
  -- one, so the history says when they were which.
  IF TG_OP = 'UPDATE' AND NEW.is_lead IS DISTINCT FROM OLD.is_lead THEN
    UPDATE job_crew_assignments
       SET unassigned_at = now()
     WHERE job_id = OLD.job_id AND profile_id = OLD.profile_id AND unassigned_at IS NULL;
    INSERT INTO job_crew_assignments (organization_id, job_id, profile_id, role, assigned_by)
    VALUES (NEW.organization_id, NEW.job_id, NEW.profile_id,
            CASE WHEN NEW.is_lead THEN 'lead' ELSE 'technician' END, NEW.added_by);
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS job_crew_keeps_history ON public.job_crew;
CREATE TRIGGER job_crew_keeps_history AFTER INSERT OR UPDATE OR DELETE ON public.job_crew
  FOR EACH ROW EXECUTE FUNCTION public.job_crew_history();

-- Everybody already on a job gets an open assignment, dated from when they
-- were added, so the history does not start at "everybody joined today".
INSERT INTO public.job_crew_assignments (organization_id, job_id, profile_id, role, assigned_by, assigned_at)
SELECT c.organization_id, c.job_id, c.profile_id,
       CASE WHEN c.is_lead THEN 'lead' ELSE 'technician' END, c.added_by, c.created_at
FROM public.job_crew c
WHERE NOT EXISTS (
  SELECT 1 FROM public.job_crew_assignments a
   WHERE a.job_id = c.job_id AND a.profile_id = c.profile_id AND a.unassigned_at IS NULL
);

-- ---------------------------------------------------------------------------
-- 5. The history of all of it
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('exception','scope_change','progress','assignment')),
  subject_id UUID NOT NULL,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor UUID,
  -- What the actor was allowed to be at the time. Roles change; the reason a
  -- person was permitted to approve something has to be readable afterwards.
  actor_roles TEXT[] NOT NULL DEFAULT '{}',
  note TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_audit_events_job_idx ON public.job_audit_events (job_id, at DESC);
CREATE INDEX IF NOT EXISTS job_audit_events_subject_idx ON public.job_audit_events (subject_kind, subject_id, at);

-- Append-only, enforced rather than intended. A history that can be edited is
-- a history somebody will edit on the day it matters most.
CREATE OR REPLACE FUNCTION public.job_audit_is_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  RAISE EXCEPTION 'job_audit_events is append-only (attempted %)', TG_OP;
END;
$fn$;
DROP TRIGGER IF EXISTS job_audit_events_immutable ON public.job_audit_events;
CREATE TRIGGER job_audit_events_immutable BEFORE UPDATE OR DELETE ON public.job_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.job_audit_is_append_only();

-- ---------------------------------------------------------------------------
-- Row-level security: same rule as every other job-shaped table.
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_scope_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_work_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_crew_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_exceptions_own_org ON public.job_exceptions;
CREATE POLICY job_exceptions_own_org ON public.job_exceptions FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS job_scope_changes_own_org ON public.job_scope_changes;
CREATE POLICY job_scope_changes_own_org ON public.job_scope_changes FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS job_work_progress_own_org ON public.job_work_progress;
CREATE POLICY job_work_progress_own_org ON public.job_work_progress FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS job_crew_assignments_own_org ON public.job_crew_assignments;
CREATE POLICY job_crew_assignments_own_org ON public.job_crew_assignments FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS job_audit_events_own_org ON public.job_audit_events;
CREATE POLICY job_audit_events_own_org ON public.job_audit_events FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- What the crew may actually do today.
-- ---------------------------------------------------------------------------
--
-- The sold scope, plus the changes a client has approved. Nothing subtracts
-- from the sold scope and nothing edits it: a dropped zone is a scope change
-- with its own record, and the March version of the job is still the March
-- version of the job.
CREATE OR REPLACE FUNCTION public.job_executable_additions(job UUID)
RETURNS TABLE(
  scope_change_id UUID,
  requested_note TEXT,
  proposed JSONB,
  price_cents BIGINT,
  terms TEXT,
  approved_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT c.id, c.requested_note, c.proposed, c.price_cents, c.terms, c.executable_at
  FROM job_scope_changes c
  WHERE c.job_id = job
    AND c.status = 'client_approved'
    AND c.executable_at IS NOT NULL
  ORDER BY c.executable_at;
$fn$;

-- What is waiting on a person, for the boards. Counted per job so "needs
-- attention" can say which desk the thing is sitting on rather than only that
-- something is wrong.
CREATE OR REPLACE FUNCTION public.jobs_with_open_exceptions(org UUID)
RETURNS TABLE(job_id UUID, open_exceptions INTEGER, blocking_exceptions INTEGER, awaiting_review INTEGER, awaiting_client INTEGER)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT j.id,
         coalesce(e.open_count, 0)::int,
         coalesce(e.blocking_count, 0)::int,
         coalesce(s.review_count, 0)::int,
         coalesce(s.client_count, 0)::int
  FROM jobs j
  LEFT JOIN (
    SELECT job_id,
           count(*) AS open_count,
           count(*) FILTER (WHERE blocks_work) AS blocking_count
    FROM job_exceptions
    WHERE organization_id = org AND state IN ('reported','acknowledged')
    GROUP BY job_id
  ) e ON e.job_id = j.id
  LEFT JOIN (
    SELECT job_id,
           count(*) FILTER (WHERE status IN ('reported','in_review','priced')) AS review_count,
           count(*) FILTER (WHERE status = 'sent_to_client') AS client_count
    FROM job_scope_changes
    WHERE organization_id = org
    GROUP BY job_id
  ) s ON s.job_id = j.id
  WHERE e.job_id IS NOT NULL OR s.job_id IS NOT NULL;
$fn$;

NOTIFY pgrst, 'reload schema';
