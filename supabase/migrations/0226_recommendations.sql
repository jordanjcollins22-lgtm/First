-- Somebody asking for a landscaper, and one of ours answering.
--
-- A neighbour posts "can anyone recommend a landscaper?" in a Facebook group
-- or on Nextdoor, and an account manager or an affiliate replies. That reply
-- is the cheapest lead the business gets and nothing recorded it: not who
-- answered, not where, not which group, and not whether anything came of it.
--
-- One row per reply. The screenshot is the evidence the post was real, which
-- matters when a referral is worth something to whoever made it.
--
-- The code is the point. Every reply gets its own, it goes in the link that is
-- posted, and a booking that comes through carries it back — so "which groups
-- are worth answering in" stops being a feeling.
create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Who replied. Their affiliate link is what goes in the post.
  profile_id uuid not null references profiles(id) on delete cascade,
  -- Short, unguessable, and in the URL. Unique across the business.
  code text not null unique,
  platform text not null check (platform in ('facebook', 'nextdoor', 'instagram', 'reddit', 'other')),
  -- The group, neighbourhood or subreddit. Free text: their names are theirs.
  group_name text,
  -- Who was asking, where they gave a name. Optional, and only ever a first name.
  asked_by text,
  -- Proof the post existed. Private: a screenshot of a group thread carries
  -- other people's names and faces, and none of that belongs in a public
  -- bucket.
  screenshot_path text,
  note text,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table recommendations is
  'One reply to somebody asking for a landscaper on social media. The code goes in the posted link and comes back on any booking, so which groups are worth answering in can be measured rather than guessed.';

create index if not exists recommendations_org_idx on recommendations (organization_id, posted_at desc);
create index if not exists recommendations_person_idx on recommendations (profile_id, posted_at desc);

alter table recommendations enable row level security;

drop policy if exists recommendations_own_org on recommendations;
create policy recommendations_own_org on recommendations
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Where a booking came from, when it came through a posted link. Null for
-- every other route in, which is most of them.
alter table jobs add column if not exists referral_code text;
create index if not exists jobs_referral_code_idx on jobs (referral_code) where referral_code is not null;

comment on column jobs.referral_code is
  'The recommendations.code carried in the link this booking came through. Null unless somebody posted a link and it was used.';

-- Screenshots are evidence, not artwork. Private, and read through a signed
-- URL by whoever can already see the marketing screens.
insert into storage.buckets (id, name, public)
values ('recommendation-shots', 'recommendation-shots', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
