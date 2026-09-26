-- Adds an image to materials, same pattern as tool images.

alter table materials add column if not exists image_path text;

insert into storage.buckets (id, name, public)
values ('material-images', 'material-images', true)
on conflict (id) do nothing;

drop policy if exists "open_read_material_images" on storage.objects;
create policy "open_read_material_images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'material-images');

drop policy if exists "open_write_material_images" on storage.objects;
create policy "open_write_material_images"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'material-images');

drop policy if exists "open_update_material_images" on storage.objects;
create policy "open_update_material_images"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'material-images');

drop policy if exists "open_delete_material_images" on storage.objects;
create policy "open_delete_material_images"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'material-images');
