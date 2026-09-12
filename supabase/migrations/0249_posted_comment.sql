-- What actually went up, next to what was written.
--
-- The comment writer produces a draft and the board keeps it, but what gets
-- pasted into Facebook is often an edited version, or somebody's own words
-- with the link dropped in. The tracked link still counts opens either way;
-- what was lost was the words those opens came from, which is the one thing
-- worth knowing when a wording works or when a claim has to be checked.
alter table outreach_links add column if not exists posted_comment text;
alter table outreach_links add column if not exists posted_comment_at timestamptz;

comment on column outreach_links.posted_comment is
  'The comment as it was actually posted, pasted back by the person who posted it. Null until they say. The draft stays in comment.';
comment on column outreach_links.posted_comment_at is
  'When they told us what they posted.';

notify pgrst, 'reload schema';
