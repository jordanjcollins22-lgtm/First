-- What a zone needs to be walked, as opposed to merely drawn.
--
-- The sheet handed to whoever walks it carries five things, and the boundary
-- is only the first: the yellow outline they must not leave, the red line
-- through the streets in the order to walk them, where to park, where to
-- start, and where it ends. Parking is its own point and not the start -- a
-- cul-de-sac you can leave a van in is rarely the first door.
--
-- The path is not derivable from the boundary. Which side of a street to walk,
-- which loop to take first, and where a footpath cuts between two closes are
-- decisions somebody makes on the ground, and the whole value of the sheet is
-- that they were made once.
--
-- The starting address is text as well as a point, because the sheet has to be
-- useful before anybody opens a map, and "1628 Eva Mar Blvd" is what gets
-- typed into a phone in a van.
ALTER TABLE hanger_zones
  ADD COLUMN IF NOT EXISTS boundary JSONB,
  ADD COLUMN IF NOT EXISTS walk_path JSONB,
  ADD COLUMN IF NOT EXISTS start_point JSONB,
  ADD COLUMN IF NOT EXISTS park_point JSONB,
  ADD COLUMN IF NOT EXISTS end_point JSONB,
  ADD COLUMN IF NOT EXISTS start_address TEXT;
