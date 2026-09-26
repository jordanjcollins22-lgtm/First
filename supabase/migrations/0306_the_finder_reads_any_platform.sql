-- The finder reads any platform.
--
-- The finder was Facebook's: every post it kept was a Facebook post, with
-- how old Facebook said it was and no record of why it was kept. It now
-- keeps posts from anywhere, each with the platform it came from, when it
-- was posted, and the reason it matched, so the team can see at a glance
-- why a post is on the board. Reddit is the first platform after Facebook,
-- read by the server on a timer with no browser and no login.

ALTER TABLE public.outreach_seen_posts
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'facebook'
    CHECK (platform IN ('facebook', 'reddit', 'nextdoor', 'instagram', 'x', 'other')),
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_reason TEXT;

-- What was known before: found at a time, and so many days old then.
UPDATE public.outreach_seen_posts
SET posted_at = created_at - make_interval(days => age_days)
WHERE posted_at IS NULL AND age_days IS NOT NULL;

CREATE INDEX IF NOT EXISTS outreach_seen_posts_platform ON public.outreach_seen_posts (organization_id, platform, created_at DESC);

ALTER TABLE public.outreach_agent_settings
  ADD COLUMN IF NOT EXISTS reddit_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reddit_subreddits TEXT[] NOT NULL DEFAULT ARRAY['harfordcounty', 'baltimore', 'maryland'],
  -- The last Reddit look: what was asked, what came back, what went wrong.
  ADD COLUMN IF NOT EXISTS last_reddit_look JSONB,
  ADD COLUMN IF NOT EXISTS last_reddit_look_at TIMESTAMPTZ,
  -- The database's own timer calls the finder with a token; only its hash
  -- is kept here, and the token itself only in the scheduled job.
  ADD COLUMN IF NOT EXISTS finder_token_hash TEXT;
