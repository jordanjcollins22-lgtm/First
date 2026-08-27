-- Door hangers: two to a sheet.
--
-- A letter sheet cut down the middle gives two 4.25" x 11" hangers, which is
-- why the size is what it is. Two rows per organisation, one a side, holding
-- the artwork that goes on each half.

create table if not exists door_hanger_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  side text not null check (side in ('left', 'right')),
  image_path text,
  label text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One artwork per side. Two on one half is not a hanger, it is a mistake
  -- somebody finds after the run.
  unique (organization_id, side)
);

create index if not exists door_hanger_slots_org_idx on door_hanger_slots(organization_id);

alter table door_hanger_slots enable row level security;
drop policy if exists "org_scoped_door_hanger_slots" on door_hanger_slots;
create policy "org_scoped_door_hanger_slots" on door_hanger_slots for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Artwork for anything that gets printed. One bucket rather than one per
-- piece — the next thing we print should not need a migration to have
-- somewhere to put its picture.
insert into storage.buckets (id, name, public)
values ('print-artwork', 'print-artwork', true)
on conflict (id) do nothing;

drop policy if exists "read_print_artwork" on storage.objects;
create policy "read_print_artwork"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'print-artwork');

drop policy if exists "write_print_artwork" on storage.objects;
create policy "write_print_artwork"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'print-artwork');

drop policy if exists "update_print_artwork" on storage.objects;
create policy "update_print_artwork"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'print-artwork');

drop policy if exists "delete_print_artwork" on storage.objects;
create policy "delete_print_artwork"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'print-artwork');

-- A door hanger node points at the door hanger designer, not the flyer.
update knowledge_nodes
set app_route = '/admin/door-hangers'
where node_type in ('marketing_channel', 'distribution_method', 'idea', 'process', 'product')
  and (title ilike '%door hanger%' or title ilike '%doorhanger%')
  and (app_route is null or app_route = '/admin/flyer');

notify pgrst, 'reload schema';
