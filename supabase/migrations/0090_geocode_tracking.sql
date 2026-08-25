-- Remembering which addresses could not be placed.
--
-- Turning an imported address into a property means asking a geocoder where it
-- is. Most resolve. Some never will — a partial "Bel Air, MD", a typo, a rural
-- route with no number — and without a record of having tried, every run works
-- through the same failures again, spending the same lookups to get the same
-- nothing, and never reaching the addresses behind them.

alter table customers add column if not exists geocode_attempted_at timestamptz;
alter table customers add column if not exists geocode_error text;

-- The working set: imported addresses nobody has placed yet. Partial so it
-- stays small as the book grows past the ones still waiting.
create index if not exists customers_pending_geocode_idx
  on customers(organization_id)
  where import_address is not null and geocode_attempted_at is null;

comment on column customers.geocode_error is
  'Why the last attempt failed. Kept so a bad address can be corrected by hand rather than silently never appearing on a map.';

notify pgrst, 'reload schema';
