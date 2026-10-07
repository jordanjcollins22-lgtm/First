-- The guard trusted the wrong thing.
--
-- assert_own_org let a caller through whenever there was no signed-in
-- user, on the reasoning that the crons and the background jobs have no
-- user and are trusted. But a request arriving with the public anon key
-- has no signed-in user either, and that key ships inside the web page.
-- So anyone could have called ops_pulse, bank_status or ops_actions_list
-- with either business's id and been handed the lot -- the exact hole the
-- last two migrations were written to close.
--
-- The test is now what it should have been: a request that came through
-- the web at all must prove whose business it is asking about. Only a
-- call with no web request behind it (the schedule, the background jobs)
-- or one carrying the service key is trusted without proof.

CREATE OR REPLACE FUNCTION public.assert_own_org(org UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claims TEXT; headers TEXT; jwt_role TEXT; mine UUID;
BEGIN
  claims := nullif(current_setting('request.jwt.claims', true), '');
  headers := nullif(current_setting('request.headers', true), '');
  -- Nothing of a web request in sight: the cron schedule and the jobs the
  -- server runs for itself, which are trusted.
  IF claims IS NULL AND headers IS NULL THEN RETURN; END IF;
  BEGIN
    jwt_role := (claims::jsonb)->>'role';
  EXCEPTION WHEN OTHERS THEN
    jwt_role := NULL;
  END;
  -- The service key is the server acting as itself.
  IF jwt_role = 'service_role' THEN RETURN; END IF;
  -- Anybody else must be signed in, and may only ask about their own.
  mine := (SELECT organization_id FROM profiles WHERE id = auth.uid());
  IF mine IS NULL OR org IS DISTINCT FROM mine THEN
    RAISE EXCEPTION 'That is not your organisation.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Nothing here is a stranger's to call. The public booking page needs
-- person_busy_windows and keeps it; the rest are for people who are
-- signed in, and the summaries are for the server alone.
REVOKE EXECUTE ON FUNCTION public.ops_pulse(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bank_status(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bank_cash(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ops_actions_list(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_own_org(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.summary_get(UUID, TEXT, INTERVAL) FROM anon;
REVOKE EXECUTE ON FUNCTION public.summary_refresh(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.summaries_refresh(UUID, TEXT[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.summary_compute(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ops_ramp(UUID, TEXT, NUMERIC, JSONB, UUID, TEXT) FROM anon;
