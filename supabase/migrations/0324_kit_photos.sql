-- A photo of each kit, as it sits on the shelf ready to grab.
--
-- A kit is only a number on the tools in it, so there was nowhere to say
-- what kit 1 looks like. The crew sees this photo when the load-out says to
-- go grab it, so nobody has to already know which box is which. The image
-- lives in the public tool-images bucket, under kits/.

create table if not exists kit_photos (
  organization_id uuid not null references organizations(id) on delete cascade,
  kit integer not null check (kit > 0),
  -- Path inside the tool-images bucket.
  image_path text not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, kit)
);

alter table kit_photos enable row level security;
drop policy if exists kit_photos_own_org on kit_photos;
create policy kit_photos_own_org on kit_photos
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
