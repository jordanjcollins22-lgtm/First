-- Storage bucket for work area photos.
insert into storage.buckets (id, name, public)
values ('work-area-photos', 'work-area-photos', true)
on conflict (id) do nothing;

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

-- Public read (bucket is public) so crew/checklist views can load images
-- without signed URLs during MVP.
drop policy if exists "public_read_work_area_photos" on storage.objects;
create policy "public_read_work_area_photos"
  on storage.objects for select
  to anon
  using (bucket_id = 'work-area-photos');
