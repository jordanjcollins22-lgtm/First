-- Posts added by hand.
--
-- Anybody on the team who comes across a post the finder missed adds it
-- from the comment card: the link, a screenshot, or both. The screenshot is
-- kept with the post, so the comment is written from the picture, and its
-- fingerprint is kept too, so the same post added twice is caught. So is who
-- added it.
ALTER TABLE public.outreach_seen_posts
  ADD COLUMN IF NOT EXISTS screenshot_path TEXT,
  ADD COLUMN IF NOT EXISTS screenshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS outreach_seen_posts_shot ON public.outreach_seen_posts (organization_id, screenshot_hash) WHERE screenshot_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS outreach_seen_posts_url ON public.outreach_seen_posts (organization_id, url);
