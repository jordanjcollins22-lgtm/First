-- A post read without its link is looked for again: the extension searches
-- its group for what it says and sends the link back. How many times it has
-- been looked for, and when it was last handed out, so each is tried a few
-- times and then left.
alter table outreach_seen_posts add column if not exists link_hunt_tries integer not null default 0;
alter table outreach_seen_posts add column if not exists link_hunt_at timestamptz;
