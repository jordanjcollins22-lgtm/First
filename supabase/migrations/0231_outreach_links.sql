-- Every link the business hands out, and what came back.
--
-- `recommendations` was one row per reply to somebody asking for a landscaper.
-- That was the right shape and the wrong scope: the same question -- where did
-- this go, who saw it, did anybody click, did anybody book -- is the question
-- for a scheduled page post, a comment under a stranger's thread, and an
-- affiliate's own link. Three tables answering one question would drift, and
-- the one that drifted would be whichever nobody was watching.
--
-- So it becomes one table. The rename keeps every code already pasted into
-- somebody else's Facebook thread working, which matters more than the name:
-- a comment posted this morning cannot be edited.
alter table if exists recommendations rename to outreach_links;
alter index if exists recommendations_org_idx rename to outreach_links_org_idx;
alter index if exists recommendations_person_idx rename to outreach_links_person_idx;

-- What kind of thing carried the link. A post goes out to a whole audience and
-- a comment goes to one person, and counting them together would say a page
-- post "converts" a hundred times worse than a reply.
alter table outreach_links add column if not exists kind text not null default 'comment'
  check (kind in ('comment', 'post', 'dm', 'flyer', 'sign', 'other'));

-- Which of OUR pages or accounts it went out from. Null for a comment made
-- from a personal profile, which is most of them, and the point of the column
-- is the scheduled posts that are coming: "the JS Landscaping page" and "the
-- Bel Air group" are different questions and both are worth an answer.
alter table outreach_links add column if not exists from_page text;

-- Who it was aimed at, where it was aimed at one person. `asked_by` under its
-- older name, kept as the same column so the rows already written keep meaning
-- what they meant.
alter table outreach_links rename column asked_by to sent_to;
-- The group, neighbourhood, subreddit or feed it landed in.
alter table outreach_links rename column group_name to audience;

-- What they wanted, matched to a service this business sells, when the post
-- said. The lead, in a word.
alter table outreach_links add column if not exists service text;

-- What came back. Clicks are counted rather than only listed, because "has
-- anybody clicked this" is asked far more often than "when exactly".
alter table outreach_links add column if not exists click_count integer not null default 0;
alter table outreach_links add column if not exists first_click_at timestamptz;
alter table outreach_links add column if not exists last_click_at timestamptz;

-- Whether the person answered, and how. Set by hand: nothing can see a reply
-- on Facebook, so pretending to detect one would be worse than asking.
alter table outreach_links add column if not exists responded_at timestamptz;
alter table outreach_links add column if not exists response text
  check (response is null or response in ('replied', 'no reply', 'not interested', 'hostile'));
alter table outreach_links add column if not exists response_note text;

comment on table outreach_links is
  'One link the business handed out -- a comment, a scheduled post, a DM, a flyer. Carries where it went and who it went to, and collects clicks, replies and bookings against that one code.';

create index if not exists outreach_links_kind_idx
  on outreach_links (organization_id, kind, posted_at desc);
create index if not exists outreach_links_audience_idx
  on outreach_links (organization_id, audience);

drop policy if exists recommendations_own_org on outreach_links;
drop policy if exists outreach_links_own_org on outreach_links;
create policy outreach_links_own_org on outreach_links
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- One row per click.
--
-- The counters on the link answer "did anybody", and this answers "when, and
-- how many times since". Kept separate because a link that gets shared into
-- three other groups collects a shape over a week that a single number cannot
-- show, and that shape is the thing worth knowing about a group.
--
-- Nothing identifying. A click is a stranger who has not asked us for
-- anything, and the only honest thing to keep is that it happened.
create table if not exists outreach_clicks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  link_id uuid not null references outreach_links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  -- Where the click came from, when the browser says. "facebook.com" is the
  -- useful part; the full URL of somebody's feed is not ours to keep.
  source text
);

comment on table outreach_clicks is
  'One click on one handed-out link. Nothing identifying: a click is a stranger who has not asked us for anything.';

create index if not exists outreach_clicks_link_idx on outreach_clicks (link_id, clicked_at desc);
create index if not exists outreach_clicks_org_idx on outreach_clicks (organization_id, clicked_at desc);

alter table outreach_clicks enable row level security;

drop policy if exists outreach_clicks_own_org on outreach_clicks;
create policy outreach_clicks_own_org on outreach_clicks
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
