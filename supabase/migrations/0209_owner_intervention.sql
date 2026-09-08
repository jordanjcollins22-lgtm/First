-- How much of the business still runs through one person.
--
-- The whole point of the last several months of work is a business that grows
-- while the owner is needed less. That is a claim, and until now nothing
-- measured it. This does, in two ways, and the difference between them
-- matters.
--
-- **Touches** are counted, not typed. Every decision recorded in
-- job_audit_events carries who made it and what they were allowed to be at the
-- time, so the number of decisions that could only be made by the owner is
-- already sitting in the data. Nobody has to remember anything for this number
-- to be true, which is exactly why it is the one to trust.
--
-- **Hours** are logged, by the owner, when they feel like it. A touch does not
-- tell you whether it cost thirty seconds or an afternoon, and there is no
-- honest way to infer that -- so it is asked for rather than guessed, and a
-- week with nothing logged reads as "not logged" rather than as zero. A made-up
-- zero would make the graph go the right way for the wrong reason, which is
-- the worst possible outcome for a number the owner is going to steer by.
--
-- The categories are there because "you spent nine hours" is not actionable
-- and "you spent six of them rescheduling" is.

CREATE TABLE IF NOT EXISTS public.owner_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Whose time it was. Usually the owner; an account manager logging the
  -- afternoon they lost to one client is worth the same to this measurement.
  profile_id UUID NOT NULL,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  category TEXT NOT NULL CHECK (category IN (
    'rescheduling',
    'client_escalation',
    'pricing_decision',
    'field_decision',
    'chasing_payment',
    'quality_rework',
    'hiring_training',
    'admin',
    'other'
  )),
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  note TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_interventions_week_idx
  ON public.owner_interventions (organization_id, occurred_on DESC);

ALTER TABLE public.owner_interventions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_interventions_own_org ON public.owner_interventions;
CREATE POLICY owner_interventions_own_org ON public.owner_interventions FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- What the owner wants to be down to. Their own number, not a benchmark.
ALTER TABLE public.ops_targets
  ADD COLUMN IF NOT EXISTS owner_hours_per_week NUMERIC NOT NULL DEFAULT 5;

-- One read for the Growth view: logged hours, where they went, and the count
-- of decisions only an owner could have made.
--
-- Weeks start on Monday, the same as everything else that windows by week.
CREATE OR REPLACE FUNCTION public.owner_intervention_load(org UUID, weeks INTEGER DEFAULT 8)
RETURNS TABLE(
  week_start DATE,
  logged_minutes INTEGER,
  entries INTEGER,
  top_category TEXT,
  top_category_minutes INTEGER,
  owner_touches INTEGER
)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH span AS (
    SELECT generate_series(
      date_trunc('week', (CURRENT_DATE - (weeks - 1) * 7)::timestamp)::date,
      date_trunc('week', CURRENT_DATE::timestamp)::date,
      '7 days'
    )::date AS week_start
  ),
  logged AS (
    SELECT date_trunc('week', occurred_on::timestamp)::date AS week_start,
           sum(minutes)::int AS logged_minutes,
           count(*)::int AS entries
    FROM owner_interventions
    WHERE organization_id = org
    GROUP BY 1
  ),
  by_category AS (
    SELECT DISTINCT ON (date_trunc('week', occurred_on::timestamp)::date)
           date_trunc('week', occurred_on::timestamp)::date AS week_start,
           category,
           sum(minutes)::int AS minutes
    FROM owner_interventions
    WHERE organization_id = org
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  ),
  -- Decisions made by somebody holding an owner-level role. Counted from the
  -- audit trail, so nobody has to remember to record anything for it to be
  -- true.
  touches AS (
    SELECT date_trunc('week', e.at)::date AS week_start, count(*)::int AS owner_touches
    FROM job_audit_events e
    WHERE e.organization_id = org
      AND EXISTS (
        SELECT 1 FROM unnest(e.actor_roles) AS r(name)
        WHERE lower(btrim(r.name)) IN ('owner', 'admin')
      )
    GROUP BY 1
  )
  SELECT s.week_start,
         coalesce(l.logged_minutes, 0),
         coalesce(l.entries, 0),
         c.category,
         coalesce(c.minutes, 0),
         coalesce(t.owner_touches, 0)
  FROM span s
  LEFT JOIN logged l ON l.week_start = s.week_start
  LEFT JOIN by_category c ON c.week_start = s.week_start
  LEFT JOIN touches t ON t.week_start = s.week_start
  ORDER BY s.week_start;
$fn$;

NOTIFY pgrst, 'reload schema';
