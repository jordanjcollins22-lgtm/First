-- The groups the business runs, and what gets posted in them.
--
-- A hyper-local Facebook group is a marketing asset that costs nothing to own
-- and pays twice: homeowners in it post "does anyone know someone who does
-- X", and businesses in it want to advertise to the same people. Both of
-- those were happening in a browser tab with nothing written down.
--
-- What this cannot do, and why: Facebook discontinued the Groups API on
-- 22 April 2024. No third-party app can read a group feed, publish to a
-- group, approve or decline a pending post, or message a member — owning the
-- group changes none of that, because the permissions no longer exist to
-- grant. Cold messages are separately impossible: Messenger only opens a
-- window after the person messages the Page first.
--
-- So the split is: Facebook's own Admin Assist does the blocking, configured
-- from words this app keeps; and everything Facebook cannot be asked about —
-- what the rules are, who paid to post, what somebody asked for, and what
-- came of it — lives here.
create table if not exists community_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  -- The neighbourhood, town or development it covers. This is the whole point
  -- of the thing: "Harford County" is a page, "Bel Air South" is a group whose
  -- members recognise each other's driveways.
  area text,
  platform text not null default 'facebook'
    check (platform in ('facebook', 'nextdoor', 'other')),
  -- Where it is. Kept so a link in the app opens the actual group, which is
  -- where every action that touches Facebook has to be finished by hand.
  external_url text,
  member_count integer check (member_count is null or member_count >= 0),

  -- What a business pays for one post. Null means business posts are not for
  -- sale in this group and the answer is simply no.
  business_post_cents integer check (business_post_cents is null or business_post_cents > 0),
  -- How long a paid pass is good for once bought.
  pass_days integer not null default 30 check (pass_days between 1 and 365),

  -- Said to somebody whose business post was declined. Pasted into Admin
  -- Assist as the decline message, and sent by hand where a reply is wanted.
  decline_message text,
  -- Words that mean "this is an advert" in this group, on top of the ones
  -- every group shares. Free text because every area sells different things.
  block_words text[] not null default '{}',

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table community_groups is
  'One local social group the business runs. Facebook removed the Groups API in April 2024, so nothing here reaches Facebook: it holds the rules, the price of a business post and the wording, and the blocking itself is done by Facebook Admin Assist configured from these words.';

create index if not exists community_groups_org_idx
  on community_groups (organization_id, archived_at, name);

alter table community_groups enable row level security;

drop policy if exists community_groups_own_org on community_groups;
create policy community_groups_own_org on community_groups
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- A business that paid to post in one of the groups.
--
-- The code is what the admin checks against when the post shows up in the
-- queue. Nothing about this can be enforced by Facebook, so the code exists to
-- make approving a post a two second lookup rather than a memory test.
create table if not exists group_post_passes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null references community_groups(id) on delete cascade,

  business_name text not null,
  contact_name text,
  email text,
  phone text,

  -- Short, unguessable, and said out loud to an admin. Unique everywhere.
  code text not null unique,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'unpaid'
    check (status in ('unpaid', 'paid', 'used', 'refunded', 'expired')),
  checkout_session_id text,

  paid_at timestamptz,
  -- Set when the money lands, from the group's pass_days.
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table group_post_passes is
  'A business paid to post once in a group. The code is what an admin checks when the post appears; Facebook cannot be asked to enforce it.';

create index if not exists group_post_passes_group_idx
  on group_post_passes (group_id, created_at desc);
create index if not exists group_post_passes_org_idx
  on group_post_passes (organization_id, status, created_at desc);

alter table group_post_passes enable row level security;

drop policy if exists group_post_passes_own_org on group_post_passes;
create policy group_post_passes_own_org on group_post_passes
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- A post somebody put in the group, sorted into what it is.
--
-- Two kinds matter. A request is a neighbour asking for work, which is a lead
-- and should be answered the same day. A promotion is a business advertising
-- for free, which is what the paid pass exists for. Everything else is
-- recorded as 'other' rather than thrown away, because the count of what got
-- waved through is how the rules get tuned.
create table if not exists community_group_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null references community_groups(id) on delete cascade,

  kind text not null check (kind in ('request', 'promotion', 'other')),
  -- What they want done, in this business's own words, when it is a request.
  service text,
  urgency text check (urgency is null or urgency in ('emergency', 'soon', 'whenever')),

  author_name text,
  summary text,
  -- The words that made the call, so a wrong one can be argued with rather
  -- than shrugged at.
  matched_words text[] not null default '{}',
  -- The post itself, pasted in or read off a screenshot.
  posted_text text,
  screenshot_path text,

  -- What was done about it, by a person, in Facebook.
  handled_at timestamptz,
  handled_note text,
  -- Set when answering it turned into a posted recommendation.
  recommendation_id uuid references recommendations(id) on delete set null,

  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table community_group_posts is
  'One post in a group, sorted into a neighbour asking for work, a business advertising, or neither. Read from pasted text or a screenshot: Facebook has no API that would hand it over.';

create index if not exists community_group_posts_group_idx
  on community_group_posts (group_id, posted_at desc);
create index if not exists community_group_posts_open_idx
  on community_group_posts (organization_id, kind, posted_at desc)
  where handled_at is null;

alter table community_group_posts enable row level security;

drop policy if exists community_group_posts_own_org on community_group_posts;
create policy community_group_posts_own_org on community_group_posts
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
