-- Ad spots on the EDDM flyer.
--
-- The flyer already goes out. Every one of them carries eight 4" x 4.75"
-- tiles across two sides, one of which is ours, so seven of them are empty
-- paper we are already paying postage on. This table is what turns those
-- seven into money: one row per spot, who bought it, what they paid, and the
-- artwork they sent.

create table if not exists flyer_ad_spots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- 1-4 front, 5-8 back, reading left to right then down. Slot 2 is the
  -- front top-right, which is ours and never for sale — that is where the
  -- postage indicia sits, and our artwork is cut to leave room for it.
  slot int not null check (slot between 1 and 8),

  business_name text,
  contact text,
  image_path text,

  -- What they paid for this run. The whole point of the table: the flyer
  -- stops being a cost and starts being a line with a number on it.
  price numeric check (price is null or price >= 0),

  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One thing per spot. Two adverts in one square is not a flyer, it is a
  -- mistake somebody finds after five thousand are printed.
  unique (organization_id, slot)
);

create index if not exists flyer_ad_spots_org_idx on flyer_ad_spots(organization_id, slot);

alter table flyer_ad_spots enable row level security;
drop policy if exists "org_scoped_flyer_ad_spots" on flyer_ad_spots;
create policy "org_scoped_flyer_ad_spots" on flyer_ad_spots for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Somewhere to put the artwork advertisers send in.
insert into storage.buckets (id, name, public)
values ('flyer-ads', 'flyer-ads', true)
on conflict (id) do nothing;

drop policy if exists "read_flyer_ads" on storage.objects;
create policy "read_flyer_ads"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'flyer-ads');

drop policy if exists "write_flyer_ads" on storage.objects;
create policy "write_flyer_ads"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'flyer-ads');

drop policy if exists "update_flyer_ads" on storage.objects;
create policy "update_flyer_ads"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'flyer-ads');

drop policy if exists "delete_flyer_ads" on storage.objects;
create policy "delete_flyer_ads"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'flyer-ads');

notify pgrst, 'reload schema';
