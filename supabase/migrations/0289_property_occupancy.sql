-- Whether the client owns the home or rents it, in their own words.
--
-- The State's roll says whether the owner claims the house as their
-- principal residence, which is a good guess and sometimes wrong. What the
-- client tells us wins. Null means nobody asked, and the roll fills in.
alter table properties add column if not exists occupancy text
  check (occupancy is null or occupancy in ('owner', 'renter'));
comment on column properties.occupancy is 'What the client told us: they own the home, or they rent it. Null means nobody asked; the State roll fills in.';
