-- How each photo sits in a planned post's picture: where its centre of
-- attention is, left to right and top to bottom (0 to 100), and how far it
-- is zoomed in (1 = fills the space). Null is the middle, unzoomed.
alter table social_posts add column if not exists before_crop jsonb;
alter table social_posts add column if not exists after_crop jsonb;
