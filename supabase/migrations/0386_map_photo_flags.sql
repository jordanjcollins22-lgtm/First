-- What a client told us about the aerial photo on their map, in one tap.
--
-- The map pre-evaluation shows the newest aerial photo there is for the
-- address, but even the newest can be a year or two old, and an address can
-- land on the house next door. Under the photo the client sees when it was
-- taken, with two quiet links: "Not up to date?" and "Not my property?".
-- A tap sets one of these, tells the team, and the estimate leans less on
-- the picture (spot sizes read off it are trusted less, or not at all).
alter table evaluation_intakes add column if not exists photo_outdated_at timestamptz;
alter table evaluation_intakes add column if not exists wrong_property_at timestamptz;
-- Which photo they were looking at, e.g. "Maryland aerial photo, 2025".
alter table evaluation_intakes add column if not exists photo_seen text;
