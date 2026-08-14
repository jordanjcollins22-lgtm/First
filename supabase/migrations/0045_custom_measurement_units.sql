-- Businesses name their own pricing unit instead of picking from a fixed
-- list. Square feet stays the default (best basis for material and time).
--
-- measurement_basis says what a per-unit price actually multiplies by, since
-- a name alone isn't enough to price a zone: 'area' uses the zone's measured
-- square footage, 'perimeter' uses its perimeter, and 'flat' charges the
-- price once per zone regardless of size.
alter table organizations drop constraint if exists organizations_measurement_unit_check;

alter table organizations add column if not exists measurement_basis text not null default 'area';
alter table organizations drop constraint if exists organizations_measurement_basis_check;
alter table organizations add constraint organizations_measurement_basis_check
  check (measurement_basis in ('area', 'perimeter', 'flat'));

update organizations
set measurement_unit = 'sq ft', measurement_basis = 'area'
where id = '00000000-0000-0000-0000-000000000001';

update organizations set measurement_basis = 'perimeter' where measurement_unit = 'linear ft';
