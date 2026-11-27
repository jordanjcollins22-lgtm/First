-- Residential salting, a set price per application.
--
-- Until now a salting application was always worked out from the bag cost and
-- the minutes a stop takes (lib/salt.ts). The owner can now set the price
-- itself, per surface; a set price is what the account manager quotes and
-- what a proposal charges. Null: still worked out from cost.

alter table organizations
  add column if not exists salt_price_both_cents integer check (salt_price_both_cents is null or salt_price_both_cents > 0),
  add column if not exists salt_price_driveway_cents integer check (salt_price_driveway_cents is null or salt_price_driveway_cents > 0),
  add column if not exists salt_price_sidewalks_cents integer check (salt_price_sidewalks_cents is null or salt_price_sidewalks_cents > 0);

comment on column organizations.salt_price_both_cents is
  'Residential salting, driveway and walkways: the set price of one application, in cents. Null: worked out from cost.';
comment on column organizations.salt_price_driveway_cents is
  'Residential salting, driveway only: the set price of one application, in cents. Null: worked out from cost.';
comment on column organizations.salt_price_sidewalks_cents is
  'Residential salting, sidewalks and walkways only: the set price of one application, in cents. Null: worked out from cost.';
