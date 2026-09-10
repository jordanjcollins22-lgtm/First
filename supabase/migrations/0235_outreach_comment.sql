-- Keep the comment that was written for the post.
--
-- It was produced, shown once, pasted, and thrown away. Which is fine right up
-- until the paste fails, the phone locks, the browser is closed, or somebody
-- wants to answer a second post in the same group and would rather start from
-- what worked than from nothing.
--
-- Cheap to keep and impossible to recover, which is the whole argument. It
-- also means the board can hand back both halves of a reply -- the words and
-- the link -- weeks later, instead of only the link.
alter table outreach_links add column if not exists comment text;

comment on column outreach_links.comment is
  'The reply that was written for this post, kept so it can be copied again. Written once and thrown away meant a failed paste lost it for good.';

notify pgrst, 'reload schema';
