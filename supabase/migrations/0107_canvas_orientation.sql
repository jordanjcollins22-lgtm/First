-- Which way the satellite photo was turned.
--
-- Every property should open the same way round: the front of the house at
-- the bottom, the way you stand looking at it from the street. The photo is
-- fetched already turned, so a reload is right without this — but an
-- evaluator coming back to nudge it needs to know where it started, and a
-- turn nobody recorded is a turn nobody can undo.

alter table canvas_designs add column if not exists image_bearing double precision not null default 0;

comment on column canvas_designs.image_bearing is
  'Compass degrees at the top of the satellite photo. 0 is north-up. Set so the front of the house points at the bottom of the frame.';

-- Whether a person has said the house is the right way round. Separate from
-- locked: locked stops the background moving, this says somebody looked.
alter table canvas_designs add column if not exists orientation_confirmed boolean not null default false;

-- Designs that already have work drawn on them were oriented by hand under
-- the old flow. Asking about them again would put a step in front of work
-- that is finished.
update canvas_designs
set orientation_confirmed = true
where orientation_confirmed = false
  and (locked = true or jsonb_array_length(property_line) > 0 or jsonb_array_length(zones) > 0);

notify pgrst, 'reload schema';
