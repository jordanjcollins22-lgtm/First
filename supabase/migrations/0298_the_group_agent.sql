-- The group agent.
--
-- The comments under "who mows lawns?" posts were found, read and written
-- by hand, and the finding was the slow part. The browser now looks through
-- the groups on a timer, sends what it finds here, and this side decides
-- which posts are worth answering, writes the comment with a tracked link,
-- and hands it back to be posted. Two tables: what the agent is allowed to
-- do, and every post it has looked at so nothing is answered twice.

CREATE TABLE IF NOT EXISTS public.outreach_agent_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- [{ "url": "https://www.facebook.com/groups/...", "name": "This Is Aberdeen" }]
  groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- A post has to contain one of these before it is sent to be read.
  keywords TEXT[] NOT NULL DEFAULT ARRAY[
    'lawn', 'mow', 'landscap', 'mulch', 'leaf', 'leaves', 'clean up', 'cleanup', 'yard',
    'hedge', 'shrub', 'bush', 'grass', 'weed', 'aerat', 'seed', 'sod', 'trim', 'edging',
    'snow', 'plow', 'salt', 'gutter', 'brush', 'overgrown', 'flower bed', 'garden'
  ],
  daily_cap INTEGER NOT NULL DEFAULT 6 CHECK (daily_cap BETWEEN 0 AND 40),
  hourly_cap INTEGER NOT NULL DEFAULT 2 CHECK (hourly_cap BETWEEN 0 AND 10),
  -- Local time, the business's zone. Nothing goes up outside these.
  active_from TEXT NOT NULL DEFAULT '08:00',
  active_to TEXT NOT NULL DEFAULT '20:00',
  -- How often each group is looked at.
  scan_every_minutes INTEGER NOT NULL DEFAULT 30 CHECK (scan_every_minutes BETWEEN 10 AND 240),
  -- A post older than this is left alone: the neighbour has found somebody.
  max_age_days INTEGER NOT NULL DEFAULT 5 CHECK (max_age_days BETWEEN 0 AND 30),
  -- True: the browser posts the comment. False: it lands on the board to paste.
  auto_post BOOLEAN NOT NULL DEFAULT true,
  paused_until TIMESTAMPTZ,
  pause_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.outreach_agent_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_agent_settings_own_org ON public.outreach_agent_settings;
CREATE POLICY outreach_agent_settings_own_org ON public.outreach_agent_settings
  FOR ALL TO authenticated
  USING (organization_id = (select current_org_id()))
  WITH CHECK (organization_id = (select current_org_id()));

-- Every post the agent has been shown, and what was decided about it.
CREATE TABLE IF NOT EXISTS public.outreach_seen_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- group id / post id, so the same post under two URLs is one post.
  post_key TEXT NOT NULL,
  url TEXT NOT NULL,
  group_name TEXT,
  author TEXT,
  text TEXT,
  age_days INTEGER,
  -- queued | posted | failed | not_request | too_old | capped | draft_failed | skipped
  decision TEXT NOT NULL,
  reason TEXT,
  link_id UUID REFERENCES outreach_links(id) ON DELETE SET NULL,
  seen_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, post_key)
);
CREATE INDEX IF NOT EXISTS outreach_seen_posts_recent ON public.outreach_seen_posts (organization_id, created_at DESC);
ALTER TABLE public.outreach_seen_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_seen_posts_own_org ON public.outreach_seen_posts;
CREATE POLICY outreach_seen_posts_own_org ON public.outreach_seen_posts
  FOR ALL TO authenticated
  USING (organization_id = (select current_org_id()))
  WITH CHECK (organization_id = (select current_org_id()));

-- A link the agent posted is marked as such, and remembers the post it went under.
ALTER TABLE public.outreach_links ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'hand';
ALTER TABLE public.outreach_links ADD COLUMN IF NOT EXISTS post_url TEXT;
