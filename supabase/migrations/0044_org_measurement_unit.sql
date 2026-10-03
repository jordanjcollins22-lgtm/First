-- Each business picks the unit it prices and estimates by. Square feet is the
-- default (and what JS Landscaping uses for everything) because it's the best
-- basis for working out material quantities and time; a business that quotes
-- edging, fencing and the like can switch to linear feet instead.
--
-- These are the only two options because they're the two things the canvas
-- actually measures per zone (area and perimeter) — a per-unit price has
-- nothing to multiply by otherwise.
alter table organizations add column if not exists measurement_unit text not null default 'sq ft';
alter table organizations drop constraint if exists organizations_measurement_unit_check;
alter table organizations add constraint organizations_measurement_unit_check
  check (measurement_unit in ('sq ft', 'linear ft'));

update organizations set measurement_unit = 'sq ft' where id = '00000000-0000-0000-0000-000000000001';
