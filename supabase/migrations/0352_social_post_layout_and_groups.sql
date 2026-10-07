-- A planned post's picture layout, chosen in the picture editor: the
-- before and after stacked or side by side, photos filled or shown whole,
-- the headline's size and the bottom bar's thickness. Null is the look
-- every post had before.
alter table social_posts add column if not exists layout jsonb;
-- Where a planned post goes. 'page' is the business page, posted on its
-- day once approved. 'group' is a post for local Facebook groups, which
-- nothing can publish to: it is copied and posted by hand, and never sent
-- to the page.
alter table social_posts add column if not exists placement text not null default 'page';
alter table social_posts drop constraint if exists social_posts_placement_check;
alter table social_posts add constraint social_posts_placement_check check (placement in ('page', 'group'));
