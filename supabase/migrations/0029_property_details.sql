-- House square footage and lot acreage, auto-filled from a property-data
-- lookup (RentCast) when a property is first added. Nullable — the lookup
-- is best-effort and may not find every address.
alter table properties add column if not exists sqft numeric;
alter table properties add column if not exists acreage numeric;
