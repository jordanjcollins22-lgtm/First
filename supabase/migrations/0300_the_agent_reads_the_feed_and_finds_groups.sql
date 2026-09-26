-- The agent reads the groups feed and search, and keeps the groups it finds.
--
-- A fixed list of groups only sees the groups somebody typed in. The groups
-- feed shows every group the account is in at once, and post search reaches
-- public groups it is not in yet. A post found in a group the account has
-- not joined cannot be answered, but the group is worth knowing about: it
-- is kept here with a count of the leads seen in it, so the owner can join
-- the ones that matter.

ALTER TABLE public.outreach_agent_settings
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '{"feed": true, "search": true, "list": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS search_phrases TEXT[] NOT NULL DEFAULT ARRAY[
    'looking for a landscaper Harford County', 'lawn care recommendations Bel Air MD', 'need lawn service Abingdon MD',
    'landscaper Aberdeen MD', 'leaf cleanup Harford County', 'snow removal Harford County', 'lawn mowing Edgewood Joppa MD'
  ],
  -- A post found by search has to mention one of these, or it is somebody
  -- in another state.
  ADD COLUMN IF NOT EXISTS area_words TEXT[] NOT NULL DEFAULT ARRAY[
    'harford', 'bel air', 'abingdon', 'aberdeen', 'havre de grace', 'edgewood', 'joppa', 'joppatowne', 'fallston',
    'forest hill', 'jarrettsville', 'churchville', 'belcamp', 'perryman', 'darlington', 'whiteford', 'pylesville',
    'street, md', 'white marsh', 'kingsville', 'perry hall', 'rosedale', 'parkville', 'nottingham',
    '21001', '21009', '21014', '21015', '21017', '21028', '21034', '21040', '21047', '21050', '21078', '21084', '21085', '21087', '21154', '21160', '21161'
  ];

CREATE TABLE IF NOT EXISTS public.outreach_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The id or slug out of the group's URL.
  group_key TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT,
  -- True once a post from it has appeared in the account's own groups feed,
  -- or a comment has gone up in it. False when only search has seen it.
  joined BOOLEAN NOT NULL DEFAULT false,
  posts_found INTEGER NOT NULL DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  -- The owner has looked and does not want it.
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, group_key)
);
ALTER TABLE public.outreach_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_groups_own_org ON public.outreach_groups;
CREATE POLICY outreach_groups_own_org ON public.outreach_groups
  FOR ALL TO authenticated
  USING (organization_id = (select current_org_id()))
  WITH CHECK (organization_id = (select current_org_id()));

-- Where a seen post came from, and which group it was in.
ALTER TABLE public.outreach_seen_posts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS group_key TEXT;
