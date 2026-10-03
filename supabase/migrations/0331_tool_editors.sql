-- Tools, kits and their photos: changed by the owner, and by nobody else
-- unless the owner allows them. Everybody in the business can still see them;
-- the crew load the truck from them.
--
-- Before this, any signed-in person could change the inventory, and anybody
-- at all -- not even signed in -- could upload over, or delete, the tool and
-- kit photos.

-- Somebody the owner has allowed to change tools, kits and their photos.
alter table public.profiles
  add column if not exists can_edit_tools boolean not null default false;

-- The owner: by the email they sign in with, which nobody in the app can
-- change for them. (A profile's email can be edited by an admin; the sign-in
-- email cannot.)
create or replace function public.is_tools_owner()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('jordan@jslandscapingmd.com', 'jordanjcollins22@gmail.com');
$$;

create or replace function public.can_edit_tools()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_tools_owner()
    or exists (select 1 from profiles where id = auth.uid() and can_edit_tools);
$$;

-- Only the owner hands the permission out: an admin can otherwise change any
-- profile, and would be able to give it to themselves.
create or replace function public.guard_can_edit_tools()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.can_edit_tools is distinct from old.can_edit_tools
     and auth.uid() is not null
     and not public.is_tools_owner() then
    raise exception 'Only the owner can decide who changes tools and kits.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_can_edit_tools on public.profiles;
create trigger guard_can_edit_tools
  before update of can_edit_tools on public.profiles
  for each row execute function public.guard_can_edit_tools();

-- The inventory tables: everybody in the business reads, only the owner and
-- those allowed write.
drop policy if exists org_scoped_tools on public.tools;
create policy tools_read on public.tools for select to authenticated
  using (organization_id = (select current_org_id()));
create policy tools_write on public.tools for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy tools_update on public.tools for update to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()))
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy tools_delete on public.tools for delete to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()));

drop policy if exists org_scoped_service_tools on public.service_tools;
create policy service_tools_read on public.service_tools for select to authenticated
  using (exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = (select current_org_id())));
create policy service_tools_write on public.service_tools for insert to authenticated
  with check ((select can_edit_tools()) and exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = (select current_org_id())));
create policy service_tools_update on public.service_tools for update to authenticated
  using ((select can_edit_tools()) and exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = (select current_org_id())))
  with check ((select can_edit_tools()) and exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = (select current_org_id())));
create policy service_tools_delete on public.service_tools for delete to authenticated
  using ((select can_edit_tools()) and exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = (select current_org_id())));

drop policy if exists kit_containers_own_org on public.kit_containers;
create policy kit_containers_read on public.kit_containers for select to authenticated
  using (organization_id = (select current_org_id()));
create policy kit_containers_write on public.kit_containers for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy kit_containers_update on public.kit_containers for update to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()))
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy kit_containers_delete on public.kit_containers for delete to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()));

drop policy if exists kit_container_parts_own_org on public.kit_container_parts;
create policy kit_container_parts_read on public.kit_container_parts for select to authenticated
  using (organization_id = (select current_org_id()));
create policy kit_container_parts_write on public.kit_container_parts for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy kit_container_parts_update on public.kit_container_parts for update to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()))
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy kit_container_parts_delete on public.kit_container_parts for delete to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()));

drop policy if exists kit_photos_own_org on public.kit_photos;
create policy kit_photos_read on public.kit_photos for select to authenticated
  using (organization_id = (select current_org_id()));
create policy kit_photos_write on public.kit_photos for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy kit_photos_update on public.kit_photos for update to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()))
  with check (organization_id = (select current_org_id()) and (select can_edit_tools()));
create policy kit_photos_delete on public.kit_photos for delete to authenticated
  using (organization_id = (select current_org_id()) and (select can_edit_tools()));

-- The photos themselves. Still public to look at (the crew sheet and the
-- load-out show them); uploading, replacing and deleting are the owner's and
-- those allowed, signed in.
drop policy if exists open_write_tool_images on storage.objects;
drop policy if exists open_update_tool_images on storage.objects;
drop policy if exists open_delete_tool_images on storage.objects;
create policy tool_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-images' and (select public.can_edit_tools()));
create policy tool_images_update on storage.objects for update to authenticated
  using (bucket_id = 'tool-images' and (select public.can_edit_tools()))
  with check (bucket_id = 'tool-images' and (select public.can_edit_tools()));
create policy tool_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tool-images' and (select public.can_edit_tools()));
