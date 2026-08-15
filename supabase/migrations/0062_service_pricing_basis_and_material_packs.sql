-- Two gaps in quoting:
--
-- 1. Every service was effectively priced per sq ft or as a flat rate.
--    Bush removal is priced per bush, and the evaluator already enters a
--    Quantity on those zones — the pricing math just ignored it and charged
--    once. pricing_basis makes "priced per each" a real option that
--    multiplies by that quantity.
--
-- 2. Materials are bought in packs (a 25-pack of sawzall blades) but priced
--    per unit. pack_size / pack_cost record the purchase, and cost_per_unit
--    is derived from them so quoting keeps using one number.

-- ============================================================
-- services.pricing_basis
-- ============================================================
alter table services add column if not exists pricing_basis text;
alter table services drop constraint if exists services_pricing_basis_check;
alter table services add constraint services_pricing_basis_check
  check (pricing_basis in ('area', 'perimeter', 'count', 'flat'));

-- Backfill to exactly what the pricing code does today, so no existing
-- service silently changes price: a cost_unit matching the org's own
-- measurement unit multiplied by the measurement; everything else was
-- charged once.
update services s
set pricing_basis = case o.measurement_basis
  when 'perimeter' then 'perimeter'
  when 'flat' then 'flat'
  else 'area'
end
from organizations o
where s.organization_id = o.id
  and s.pricing_basis is null
  and lower(trim(s.cost_unit)) = 'per ' || lower(trim(o.measurement_unit));

update services set pricing_basis = 'flat' where pricing_basis is null;

alter table services alter column pricing_basis set default 'flat';
alter table services alter column pricing_basis set not null;

-- ============================================================
-- materials pack pricing
-- ============================================================
-- What a purchase actually looks like: pack_size units for pack_cost
-- dollars. cost_per_unit stays the single number quoting reads, derived as
-- pack_cost / pack_size whenever both are set.
alter table materials add column if not exists pack_size numeric;
alter table materials add column if not exists pack_cost numeric;

notify pgrst, 'reload schema';
