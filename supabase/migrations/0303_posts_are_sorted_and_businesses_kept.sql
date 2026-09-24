-- Posts are sorted, and the businesses advertising are kept.
--
-- Every post the browser reads is sorted as it arrives: somebody asking
-- for work to be done, somebody advertising their own work, or anything
-- else. The owner still picks which requests to answer; the sort decides
-- what they see first. The owner can correct a sort, and a correction is
-- marked as theirs so it can be told apart from the model's guess.
--
-- A business advertising in a local group is a possible subcontractor.
-- Its details, as written in the post, are kept in one row per business,
-- matched on phone, then email, then name, so the same painter posting in
-- three groups is one row seen three times.
ALTER TABLE public.outreach_seen_posts
  ADD COLUMN IF NOT EXISTS kind TEXT CHECK (kind IN ('request', 'promotion', 'other')),
  ADD COLUMN IF NOT EXISTS kind_by TEXT CHECK (kind_by IN ('model', 'owner')),
  ADD COLUMN IF NOT EXISTS business_id UUID;

CREATE TABLE IF NOT EXISTS public.outreach_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_key TEXT NOT NULL,
  name TEXT,
  person TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  services TEXT[] NOT NULL DEFAULT '{}',
  area TEXT,
  times_seen INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_post_url TEXT,
  last_post_text TEXT,
  last_group_name TEXT,
  notes TEXT,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, business_key)
);
ALTER TABLE public.outreach_businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_businesses_own_org ON public.outreach_businesses;
CREATE POLICY outreach_businesses_own_org ON public.outreach_businesses
  FOR ALL TO authenticated
  USING (organization_id = (select current_org_id()))
  WITH CHECK (organization_id = (select current_org_id()));
CREATE INDEX IF NOT EXISTS outreach_seen_posts_unsorted ON public.outreach_seen_posts (organization_id, created_at DESC) WHERE decision = 'read' AND kind IS NULL;
