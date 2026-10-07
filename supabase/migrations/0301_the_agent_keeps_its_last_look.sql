-- What the agent saw on its last look.
--
-- A look that found nothing used to say so only in the popup, on the one
-- computer running it. The browser now sends what the page looked like
-- every time: how many posts it read, how many mentioned the work, how
-- many of those had a link it could open, and the first few lines of a
-- handful of them. Kept here, one row per business and overwritten each
-- look, so a scanner that has stopped seeing posts can be diagnosed from
-- the app.
ALTER TABLE public.outreach_agent_settings
  ADD COLUMN IF NOT EXISTS last_look JSONB,
  ADD COLUMN IF NOT EXISTS last_look_at TIMESTAMPTZ;
