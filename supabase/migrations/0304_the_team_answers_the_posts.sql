-- The team answers the posts.
--
-- The browser used to post every comment itself, all from the owner's
-- account, and one account answering every "who mows lawns?" post in the
-- county is exactly what Facebook bans. The browser only finds posts now.
-- They go on a board the whole team can see, and each person who answers
-- one gets a comment written for them, with their own tracked link, and
-- posts it from their own account.
--
-- One row per person per post: who took it, the comment written for them,
-- the link it carries, and whether it went up. The board reads these to
-- keep two people from answering the same neighbour.

CREATE TABLE IF NOT EXISTS public.outreach_post_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seen_post_id UUID NOT NULL REFERENCES outreach_seen_posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  link_id UUID REFERENCES outreach_links(id) ON DELETE SET NULL,
  comment TEXT,
  -- written: the comment is theirs and not posted yet
  -- posted:  they say it is up
  -- let_go:  they handed it back for somebody else
  status TEXT NOT NULL DEFAULT 'written' CHECK (status IN ('written', 'posted', 'let_go')),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seen_post_id, profile_id)
);
CREATE INDEX IF NOT EXISTS outreach_post_answers_post ON public.outreach_post_answers (organization_id, seen_post_id);
CREATE INDEX IF NOT EXISTS outreach_post_answers_person ON public.outreach_post_answers (profile_id, created_at DESC);

ALTER TABLE public.outreach_post_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_post_answers_own_org ON public.outreach_post_answers;
CREATE POLICY outreach_post_answers_own_org ON public.outreach_post_answers
  FOR ALL TO authenticated
  USING (organization_id = (select current_org_id()))
  WITH CHECK (organization_id = (select current_org_id()));

-- The browser no longer posts, so there is nothing to post without asking.
UPDATE public.outreach_agent_settings SET auto_post = false WHERE auto_post;

-- The board is open to everybody who can already hand out a tracked link.
INSERT INTO public.role_permissions (role_name, tab_key, granted)
SELECT role_name, 'posts-to-answer', granted
FROM public.role_permissions
WHERE tab_key = 'recommendations'
ON CONFLICT DO NOTHING;
