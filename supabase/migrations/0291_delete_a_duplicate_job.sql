-- Taking a copied booking off, without losing what it recorded.
--
-- The calendar pull booked some visits twice. A copy with nothing of value
-- on it can be deleted outright, but the job's audit trail is append-only
-- and a delete cascades into it. So the delete goes through one function:
-- it refuses a job with money, work or an accepted proposal on it, keeps a
-- snapshot of the job and its audit trail in deleted_jobs, and only then
-- lets the cascade through. Nothing else can delete audit rows.

CREATE TABLE IF NOT EXISTS public.deleted_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  job_number INTEGER,
  name TEXT,
  address TEXT,
  customer_name TEXT,
  reason TEXT,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- The job row and its audit trail, as they were.
  job JSONB NOT NULL,
  audit JSONB NOT NULL DEFAULT '[]'::jsonb,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.deleted_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deleted_jobs_own_org ON public.deleted_jobs;
CREATE POLICY deleted_jobs_own_org ON public.deleted_jobs
  FOR SELECT USING (organization_id = (select current_org_id()));

-- The trail stays append-only for everyone. Only delete_job, which has
-- already copied the trail into deleted_jobs, may let a delete through.
CREATE OR REPLACE FUNCTION public.job_audit_is_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.deleting_job', true) = 'snapshot taken' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'job_audit_events is append-only (attempted %)', TG_OP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.delete_job(the_job UUID, by UUID, why TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j RECORD; org UUID; the_property UUID; the_customer UUID;
  property_removed BOOLEAN := false; customer_removed BOOLEAN := false;
BEGIN
  SELECT jobs.*, p.address, p.customer_id, cu.name AS customer_name, cu.organization_id AS org_id
    INTO j
  FROM jobs JOIN properties p ON p.id = jobs.property_id JOIN customers cu ON cu.id = p.customer_id
  WHERE jobs.id = the_job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Couldn''t find that job.'; END IF;
  org := j.org_id; the_property := j.property_id; the_customer := j.customer_id;

  -- Only somebody in the org, and only an owner or admin.
  IF NOT EXISTS (
    SELECT 1 FROM profiles pr WHERE pr.id = by AND pr.organization_id = org
      AND EXISTS (SELECT 1 FROM profile_roles r WHERE r.profile_id = pr.id AND r.role_name IN ('owner', 'admin'))
  ) THEN
    RAISE EXCEPTION 'Only an owner or admin can delete a job.';
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE job_id = the_job) THEN
    RAISE EXCEPTION 'Money was taken on this job. Cancel it instead of deleting it.';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE job_id = the_job) THEN
    RAISE EXCEPTION 'This job has an invoice. Cancel it instead of deleting it.';
  END IF;
  IF EXISTS (SELECT 1 FROM job_proposals WHERE job_id = the_job AND status IN ('accepted', 'paid')) THEN
    RAISE EXCEPTION 'The client accepted a proposal on this job. Cancel it instead of deleting it.';
  END IF;
  IF EXISTS (SELECT 1 FROM job_work_sessions WHERE job_id = the_job)
     OR EXISTS (SELECT 1 FROM time_entries WHERE job_id = the_job) THEN
    RAISE EXCEPTION 'Work was logged on this job. Cancel it instead of deleting it.';
  END IF;

  INSERT INTO deleted_jobs (organization_id, job_id, job_number, name, address, customer_name, reason, deleted_by, job, audit)
  SELECT org, the_job, j.job_number, j.name, j.address, j.customer_name, why, by,
         (SELECT to_jsonb(x) FROM jobs x WHERE x.id = the_job),
         coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM job_audit_events e WHERE e.job_id = the_job), '[]'::jsonb);

  PERFORM set_config('app.deleting_job', 'snapshot taken', true);
  DELETE FROM jobs WHERE id = the_job;
  PERFORM set_config('app.deleting_job', '', true);

  -- The address row goes when this was its only job and no county house
  -- is linked to it; the client goes when that was their only address and
  -- nothing else remembers them. The database refuses the latter when
  -- something still points at them, and that refusal is the right answer.
  IF NOT EXISTS (SELECT 1 FROM jobs WHERE property_id = the_property)
     AND NOT EXISTS (SELECT 1 FROM houses WHERE property_id = the_property) THEN
    BEGIN
      DELETE FROM properties WHERE id = the_property;
      property_removed := true;
    EXCEPTION WHEN foreign_key_violation THEN property_removed := false;
    END;
    IF property_removed AND NOT EXISTS (SELECT 1 FROM properties WHERE customer_id = the_customer) THEN
      BEGIN
        DELETE FROM customers WHERE id = the_customer;
        customer_removed := true;
      EXCEPTION WHEN foreign_key_violation THEN customer_removed := false;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object('deleted', true, 'property_removed', property_removed, 'customer_removed', customer_removed);
END $$;

REVOKE ALL ON FUNCTION public.delete_job(UUID, UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_job(UUID, UUID, TEXT) TO authenticated, service_role;
