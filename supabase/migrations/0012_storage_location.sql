-- Where a tool or material is physically stored (e.g. "Shop shelf 3",
-- "Truck 1", "Trailer B").

alter table tools add column if not exists storage_location text;
alter table materials add column if not exists storage_location text;
