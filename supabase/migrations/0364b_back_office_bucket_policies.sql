-- Who may read and upload in the two private back-office buckets.
--
-- The app itself writes and signs links with the service role, so these are
-- the floor for anything done as a signed-in person: an admin of the business,
-- and only inside that business's own folder (every path starts with the
-- organization id).
create policy back_office_docs_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('compliance-docs', 'hr-docs')
    and (storage.foldername(name))[1] = (select current_org_id())::text
    and (select is_admin())
  );
create policy back_office_docs_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('compliance-docs', 'hr-docs')
    and (storage.foldername(name))[1] = (select current_org_id())::text
    and (select is_admin())
  );
