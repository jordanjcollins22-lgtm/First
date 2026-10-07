-- The week's posts, written ahead and approved one by one: not every post
-- comes from one job's before and after any more. A planned post has its
-- hook, its main text, its call to action and its hashtags kept apart so
-- each can be edited, the day it is meant for, the tracked link it carries,
-- and how its picture is drawn. Draft until the owner approves it.
alter table social_posts alter column job_id drop not null;
alter table social_posts add column if not exists kind text;
alter table social_posts add column if not exists hook text;
alter table social_posts add column if not exists body text;
alter table social_posts add column if not exists cta text;
alter table social_posts add column if not exists hashtags text[] not null default '{}';
alter table social_posts add column if not exists plan_day date;
alter table social_posts add column if not exists link_id uuid references outreach_links(id) on delete set null;
alter table social_posts add column if not exists card_style text;
create index if not exists social_posts_plan_idx on social_posts (organization_id, plan_day) where plan_day is not null;
