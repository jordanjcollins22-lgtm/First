-- Positive evidence, and what happens about money nobody is going to pay.
--
-- Readiness used to be inferred from silence: "no material issue has been
-- raised" was treated as "the mulch is on the truck". Those are not the same
-- sentence, and a crew must never be sent out on the first one. So the three
-- things a job needs before somebody drives to it -- materials, equipment and
-- access -- are three-state, and the middle state is the default:
--
--   not_required          no service on this job needs any
--   required_unconfirmed  needed, and nobody has checked
--   confirmed             somebody has checked, and here is who and when
--
-- Most of the time the state is worked out from records the business already
-- keeps: which materials the sold services list, and whether those are in
-- stock or on order. A row here is a person overruling that, in either
-- direction. Access has nothing to read from anywhere, so it starts
-- unconfirmed on every job -- getting onto a property is not a thing to
-- discover on the morning.
--
-- A confirmation is not the opposite of an issue and does not close one. A
-- confirmation answers "have we verified what needs to be true"; an issue
-- answers "is there a known problem". Both can be true: the materials were
-- confirmed on Tuesday and the supplier rang on Wednesday. The issue stops the
-- job on its own, and the confirmation is not rubbed out to make it do so.
--
-- job_financial_dispositions is the other half. An unpaid balance does not
-- stop a job being Completed, because the landscaping really is finished --
-- but it does not get to disappear either. It keeps the job in Needs attention
-- until it is settled or until somebody records here that it is waived,
-- written off, refunded, on a plan, disputed or with collections. There is no
-- way to quiet it by pretending it was paid.

CREATE TABLE IF NOT EXISTS public.job_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('materials','equipment','access')),
  state TEXT NOT NULL CHECK (state IN ('not_required','required_unconfirmed','confirmed')),
  note TEXT,
  confirmed_by UUID,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind)
);
CREATE INDEX IF NOT EXISTS job_confirmations_job_idx ON public.job_confirmations (job_id);

CREATE TABLE IF NOT EXISTS public.job_financial_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('waived','written_off','refunded','payment_plan','disputed','collections')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  decided_by UUID,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Closed rather than deleted: what the business decided in March is part of
  -- the job's history in June.
  cleared_at TIMESTAMPTZ,
  cleared_by UUID
);
CREATE INDEX IF NOT EXISTS job_financial_dispositions_job_idx ON public.job_financial_dispositions (job_id, cleared_at);

ALTER TABLE public.job_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_financial_dispositions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_confirmations_own_org ON public.job_confirmations;
CREATE POLICY job_confirmations_own_org ON public.job_confirmations FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS job_financial_dispositions_own_org ON public.job_financial_dispositions;
CREATE POLICY job_financial_dispositions_own_org ON public.job_financial_dispositions FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

NOTIFY pgrst, 'reload schema';
