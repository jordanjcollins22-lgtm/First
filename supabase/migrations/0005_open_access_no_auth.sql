-- This app has no login screen — every request goes through as the
-- anonymous Supabase role, not "authenticated". The original policies from
-- 0001-0004 only granted access to "authenticated", which silently blocked
-- every insert/update (RLS violation) for an app with no sign-in flow.
-- This is still an internal, single-user tool (see 0001's comment), so the
-- fix is to open these same permissive policies up to the anon role too,
-- rather than bolting on a login system nothing in the app expects.

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'properties', 'jobs', 'zones', 'work_areas',
    'work_area_geometry_versions', 'service_templates', 'photos',
    'tools', 'materials', 'service_tools', 'service_materials', 'services'
  ]
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to anon, authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

drop policy if exists "authenticated_read_work_area_photos" on storage.objects;
create policy "authenticated_read_work_area_photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'work-area-photos');

drop policy if exists "authenticated_write_work_area_photos" on storage.objects;
create policy "authenticated_write_work_area_photos"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'work-area-photos');

drop policy if exists "authenticated_delete_work_area_photos" on storage.objects;
create policy "authenticated_delete_work_area_photos"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'work-area-photos');
