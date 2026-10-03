-- Optional, more specific storage detail (e.g. "Shelf 3, Bin B") shown
-- alongside the existing "Stored at" location. Separate concept: "Stored at"
-- (storage_location) says WHICH location (shop, truck, job site...) and is
-- now required whenever a tool/material is added with quantity > 0
-- (enforced in app code, not here, since existing rows may already have
-- quantity with no location). shop_location is just extra detail within
-- that location and stays optional.
alter table tools add column if not exists shop_location text;
alter table materials add column if not exists shop_location text;
