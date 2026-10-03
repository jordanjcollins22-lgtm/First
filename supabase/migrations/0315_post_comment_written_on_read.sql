-- A post for us gets its comment written the moment it is sorted, so the
-- affiliate opening the card finds it already in the comment field rather
-- than pressing a button and waiting for it to be written.
--
-- Kept on the post, once, with a neutral opener and the link left as a
-- placeholder: whoever takes it gets their own opener and their own tracked
-- link put in when they use it. drafted_at marks a post as tried, written or
-- not, so a post the writer refused is not tried again on every pass.
alter table outreach_seen_posts
  add column if not exists draft_comment text,
  add column if not exists draft_asked_by text,
  add column if not exists draft_service text,
  add column if not exists draft_note text,
  add column if not exists draft_error text,
  add column if not exists drafted_at timestamptz;
create index if not exists outreach_seen_posts_to_draft
  on outreach_seen_posts (organization_id, created_at desc)
  where kind = 'request' and decision = 'read' and drafted_at is null;
