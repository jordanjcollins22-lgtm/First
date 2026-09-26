-- Every post the finder reads goes one of two ways: it is for us, and goes
-- on the affiliates' board, or it is kept as data on what people in the
-- area are asking for and talking about. So each post is labelled: what
-- kind of post it is, what service it is about, and which town, with the
-- sorter's reason in a few words.
alter table outreach_seen_posts
  add column if not exists category text,
  add column if not exists service text,
  add column if not exists town text,
  add column if not exists sort_reason text;
create index if not exists outreach_seen_posts_category on outreach_seen_posts (organization_id, category, created_at desc);
