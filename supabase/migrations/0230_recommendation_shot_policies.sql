-- The bucket existed. Nobody could put anything in it.
--
-- 0226 created `recommendation-shots` private and stopped there, and a private
-- bucket with no policy on storage.objects refuses every write, including from
-- the signed-in staff member the feature is for. So asking for a signed upload
-- URL came back "new row violates row-level security policy", which was then
-- shown to the person standing in a garden trying to answer a post.
--
-- Scoped to the organisation's own folder rather than thrown open the way the
-- older buckets were. Uploads are written as `<organization_id>/<uuid>.<ext>`,
-- and a screenshot of a group thread carries other people's names and faces —
-- which is exactly the thing that should not be readable across a tenant
-- boundary just because both tenants are signed in.
drop policy if exists read_recommendation_shots on storage.objects;
create policy read_recommendation_shots on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recommendation-shots'
    and (storage.foldername(name))[1] = current_org_id()::text
  );

drop policy if exists write_recommendation_shots on storage.objects;
create policy write_recommendation_shots on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recommendation-shots'
    and (storage.foldername(name))[1] = current_org_id()::text
  );

-- Needed as well as insert: a signed upload URL that is used twice, or a
-- retry after a dropped connection, lands as an update on an existing row.
drop policy if exists update_recommendation_shots on storage.objects;
create policy update_recommendation_shots on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recommendation-shots'
    and (storage.foldername(name))[1] = current_org_id()::text
  )
  with check (
    bucket_id = 'recommendation-shots'
    and (storage.foldername(name))[1] = current_org_id()::text
  );

drop policy if exists delete_recommendation_shots on storage.objects;
create policy delete_recommendation_shots on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recommendation-shots'
    and (storage.foldername(name))[1] = current_org_id()::text
  );
