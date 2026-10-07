-- Somebody trying out with us.
--
-- A trial crew member brings their own tools, meets us on site, and is
-- shown the work and nothing else: no shop morning, no clock, no
-- leaderboard, no alerts. The flag is on the profile, and it is what the
-- day and the crew sheet read to strip themselves down.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_crew BOOLEAN NOT NULL DEFAULT false;
