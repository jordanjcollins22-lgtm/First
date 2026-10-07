-- How many people reacted to, commented on and shared a post the finder
-- read, as of the last time it saw the post, and for a business's advert
-- what kind of pitch it was. Kept so the office can see which posts get a
-- response: other businesses' adverts first, to learn what works for them.
alter table outreach_seen_posts add column if not exists reactions integer;
alter table outreach_seen_posts add column if not exists comment_count integer;
alter table outreach_seen_posts add column if not exists share_count integer;
alter table outreach_seen_posts add column if not exists engagement_at timestamptz;
alter table outreach_seen_posts add column if not exists pitch text;

comment on column outreach_seen_posts.pitch is
  'For a business advert: the kind of pitch, as the sorter named it (before-after, deal, openings, seasonal, services-list, testimonial, other).';

notify pgrst, 'reload schema';
