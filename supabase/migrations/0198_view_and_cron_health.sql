-- The last cross-business door, and two schedules that had outlived their reason.
--
-- job_house pairs a job with the house it stands on. It was created as a
-- SECURITY DEFINER view, which means it reads underneath row security, and
-- it was readable without being signed in at all -- so it handed out every
-- job-to-house pairing on the database, both businesses, to anybody. It now
-- reads as whoever asks, so the row security put on jobs and houses applies
-- to it too, and a stranger cannot read it at all. Nothing in the app reads
-- it; it exists for queries by hand.
--
-- The zone re-walk ran every minute to redraw 245 zones on the new roads.
-- They were all redrawn hours ago and it has been asking an empty question
-- sixty times an hour since; every five minutes is plenty for the next time
-- the roads change. And the kept answers were refreshed every ten minutes,
-- which meant recomputing the county's map points -- eight seconds of work
-- over a hundred and seventeen thousand houses -- a hundred and forty times
-- a day. They are read from the cache in under a fifth of a second and go
-- stale at forty-five minutes, so every half hour keeps them warm at a third
-- of the cost.

ALTER VIEW public.job_house SET (security_invoker = on);
REVOKE ALL ON public.job_house FROM anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zones-rewalk') THEN PERFORM cron.unschedule('zones-rewalk'); END IF;
    PERFORM cron.schedule('zones-rewalk', '*/5 * * * *', 'SELECT public.zones_rewalk_tick(12)');
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'summaries-refresh') THEN PERFORM cron.unschedule('summaries-refresh'); END IF;
    PERFORM cron.schedule('summaries-refresh', '*/30 * * * *', 'SELECT public.summaries_refresh(id) FROM public.organizations');
  END IF;
END $$;
