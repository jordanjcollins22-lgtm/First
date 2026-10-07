-- A visit moved in the app, but not yet on the GoHighLevel calendar.
--
-- The calendar pull took GoHighLevel's time as the truth for any visit it
-- already knew, so a visit moved straight in the database was moved back
-- the next time anybody opened My Day. This flag says the app's time is
-- the newer one: the next pull pushes it to the calendar instead of
-- reading the calendar over it, then clears the flag.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ghl_push_pending BOOLEAN NOT NULL DEFAULT false;
