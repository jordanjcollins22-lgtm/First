-- A post can be put on the board by its words alone, before anything has
-- read it: when no model is on hand, a post that names yard work and asks
-- for someone goes up straight away, marked 'words', for a later sort or
-- a person to confirm.
alter table outreach_seen_posts drop constraint if exists outreach_seen_posts_kind_by_check;
alter table outreach_seen_posts add constraint outreach_seen_posts_kind_by_check
  check (kind_by = any (array['model'::text, 'owner'::text, 'words'::text]));
