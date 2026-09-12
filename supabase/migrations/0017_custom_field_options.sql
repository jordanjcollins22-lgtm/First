-- Tracks free-text values typed into an "Other" field on the zone service
-- dialog, so the same value shows up as a normal pick next time instead of
-- requiring "Other" + retyping the explanation again.

create table if not exists custom_field_options (
  id uuid primary key default gen_random_uuid(),
  service_type_id text not null,
  field_key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (service_type_id, field_key, value)
);

alter table custom_field_options enable row level security;
drop policy if exists "authenticated_full_access" on custom_field_options;
create policy "authenticated_full_access" on custom_field_options for all to anon, authenticated using (true) with check (true);
