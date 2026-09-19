-- Cost and time estimates per service, editable from /admin/service-pricing.
-- service_type_id matches the ids in src/components/canvas/service-catalog.ts
-- (same convention as service_tools/service_materials in 0003) — the field
-- schema and checklist logic for each service stay code-defined; this table
-- only adds the pricing/time data on top so it's a database-editable
-- selection rather than hardcoded.

create table if not exists services (
  service_type_id text primary key,
  cost numeric(10, 2),
  cost_unit text not null default 'flat rate',
  estimated_hours numeric(6, 2),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on services;
create trigger set_updated_at before update on services for each row execute function set_updated_at();

alter table services enable row level security;

drop policy if exists "authenticated_full_access" on services;
create policy "authenticated_full_access" on services for all to authenticated using (true) with check (true);

-- Seed a row per built-in service type so /admin/service-pricing has
-- something to edit immediately (cost/hours start blank).
insert into services (service_type_id) values
  ('landscape-bed'),
  ('plant-bush-removal'),
  ('plant-installation'),
  ('trimming'),
  ('landscape-cleanup'),
  ('lawn-restoration'),
  ('grading'),
  ('leaf-seasonal-cleanup'),
  ('soft-washing')
on conflict (service_type_id) do nothing;
