-- Services stop being a fixed, hardcoded list. Every business now builds its
-- own service catalog from scratch: an admin adds a service directly, or a
-- team member proposes one mid-quote and an admin accepts (sets pricing) or
-- denies it (shows as "outside our scope" on that job instead of a price).
--
-- The 9 built-in service types (their guided checklist questions still live
-- in code, unchanged) become regular rows for the existing default org only,
-- so nothing breaks for the business already using them. Brand new
-- businesses start with an empty services list.
alter table services add column if not exists name text;
alter table services add column if not exists status text not null default 'active';
alter table services drop constraint if exists services_status_check;
alter table services add constraint services_status_check
  check (status in ('active', 'pending', 'denied'));
alter table services add column if not exists requested_by uuid references profiles(id);
alter table services add column if not exists requested_note text;

-- COGS-based pricing: price = COGS x 2 (50% gross margin) + 10% buffer.
-- Cost stays the actual sale price used everywhere pricing is read from —
-- cogs is just the reference input it was calculated from, kept for
-- transparency/editing later. Both null for rows priced by hand with no
-- COGS tracked.
alter table services add column if not exists cogs numeric;

insert into services (organization_id, service_type_id, name, status, cost_unit)
values
  ('00000000-0000-0000-0000-000000000001', 'landscape-bed', 'Landscape Bed', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'plant-bush-removal', 'Plant / Bush Removal', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'plant-installation', 'Plant Installation', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'trimming', 'Trimming', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'landscape-cleanup', 'Landscape Cleanup', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'lawn-restoration', 'Lawn Restoration', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'lawn-care', 'Lawn Care', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'grading', 'Grading', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'leaf-seasonal-cleanup', 'Leaf / Seasonal Cleanup', 'active', 'flat rate'),
  ('00000000-0000-0000-0000-000000000001', 'soft-washing', 'Soft Washing', 'active', 'flat rate')
on conflict (organization_id, service_type_id) do update set name = excluded.name, status = 'active';

update services set name = coalesce(name, service_type_id) where name is null;
alter table services alter column name set not null;
