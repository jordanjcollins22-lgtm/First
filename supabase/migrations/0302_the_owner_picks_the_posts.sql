-- The owner picks the posts.
--
-- The model decided which posts were worth answering, and the owner could
-- not see the ones it passed over. Now every post the browser reads is
-- kept, with whether it mentioned the work, and nothing is written until
-- the owner picks it. The pick is kept too, accepted or declined, so there
-- is a record of which posts a person would answer to tune the reading
-- against later.
ALTER TABLE public.outreach_agent_settings ADD COLUMN IF NOT EXISTS pick_posts BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.outreach_seen_posts
  ADD COLUMN IF NOT EXISTS matched BOOLEAN,
  ADD COLUMN IF NOT EXISTS picked TEXT CHECK (picked IN ('accepted', 'declined')),
  ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS outreach_seen_posts_to_pick ON public.outreach_seen_posts (organization_id, created_at DESC) WHERE decision = 'read';
