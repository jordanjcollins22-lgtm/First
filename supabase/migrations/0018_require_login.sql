-- Requires a real login. 0005 opened every policy to the "anon" role because
-- the app had no sign-in flow yet — anyone with the URL could read AND write
-- everything. Now that individual accounts exist, this locks every table and
-- storage write back down to "authenticated" only, matching the original
-- 0001-0004 intent. Anonymous read of the image buckets is left alone: those
-- buckets are public (public URLs bypass RLS anyway), and letting someone
-- view an already-shared photo link without signing in isn't a real exposure
-- the way write access or customer/job data would be.

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'properties', 'jobs',
    'tools', 'materials', 'service_tools', 'service_materials', 'services',
    'canvas_designs', 'custom_field_options'
  ]
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- work-area-photos: read stays public (see 0002's public_read_work_area_photos,
-- untouched here); write/delete require login.
drop policy if exists "authenticated_read_work_area_photos" on storage.objects;
create policy "authenticated_read_work_area_photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'work-area-photos');

drop policy if exists "authenticated_write_work_area_photos" on storage.objects;
create policy "authenticated_write_work_area_photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'work-area-photos');

drop policy if exists "authenticated_delete_work_area_photos" on storage.objects;
create policy "authenticated_delete_work_area_photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'work-area-photos');

-- tool-images: no public-read carve-out was ever intentional here (unlike
-- work-area-photos), so lock down all four operations.
drop policy if exists "open_read_tool_images" on storage.objects;
create policy "open_read_tool_images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'tool-images');

drop policy if exists "open_write_tool_images" on storage.objects;
create policy "open_write_tool_images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'tool-images');

drop policy if exists "open_update_tool_images" on storage.objects;
create policy "open_update_tool_images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'tool-images');

drop policy if exists "open_delete_tool_images" on storage.objects;
create policy "open_delete_tool_images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'tool-images');

-- canvas-images: same as above.
drop policy if exists "open_read_canvas_images" on storage.objects;
create policy "open_read_canvas_images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'canvas-images');

drop policy if exists "open_write_canvas_images" on storage.objects;
create policy "open_write_canvas_images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'canvas-images');

drop policy if exists "open_update_canvas_images" on storage.objects;
create policy "open_update_canvas_images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'canvas-images');

drop policy if exists "open_delete_canvas_images" on storage.objects;
create policy "open_delete_canvas_images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'canvas-images');

-- material-images: same as above.
drop policy if exists "open_read_material_images" on storage.objects;
create policy "open_read_material_images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'material-images');

drop policy if exists "open_write_material_images" on storage.objects;
create policy "open_write_material_images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'material-images');

drop policy if exists "open_update_material_images" on storage.objects;
create policy "open_update_material_images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'material-images');

drop policy if exists "open_delete_material_images" on storage.objects;
create policy "open_delete_material_images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'material-images');
