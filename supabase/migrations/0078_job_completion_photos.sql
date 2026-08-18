-- Signing a job off with proof.
--
-- Marking work complete was a status change and nothing else: no record of who
-- said so, when, or what the site actually looked like when they left. That is
-- the one moment worth photographing — it is what settles a callback three
-- weeks later, and what a client sees when they ask what they paid for.

-- ---------------------------------------------------------------------------
-- Who signed it off
-- ---------------------------------------------------------------------------

-- Mirrors the cancellation columns from 0077 rather than inventing a second
-- pattern: the ending is on the job row either way.
alter table jobs add column if not exists completed_at timestamptz;
alter table jobs add column if not exists completed_by uuid references profiles(id);
alter table jobs add column if not exists completion_notes text;

-- ---------------------------------------------------------------------------
-- The photos
-- ---------------------------------------------------------------------------

create table if not exists job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),

  -- Path inside the job-photos bucket. First segment is the job id, which is
  -- what the storage policies below check, so the path is the access rule.
  path text not null unique,

  -- Before/after is the pair that actually answers a dispute; 'issue' is for
  -- the thing found on site that nobody wants to argue about later.
  kind text not null default 'after' check (kind in ('before', 'after', 'issue')),
  caption text,

  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists job_photos_job_idx on job_photos(job_id, created_at);
create index if not exists job_photos_org_idx on job_photos(organization_id);

alter table job_photos enable row level security;

-- Same audience as the job itself. Anyone who can open the job can see and add
-- its photos — the crew who did the work are exactly who needs to upload them,
-- and they are not admins.
drop policy if exists "org_scoped_job_photos" on job_photos;
create policy "org_scoped_job_photos" on job_photos for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_photos.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_photos.job_id and c.organization_id = current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private. These are photographs of customers' homes; a public bucket would
-- make every one of them readable by anyone holding the URL.
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

-- Access is decided by the first path segment being a job in the caller's
-- organization, the same shape message-attachments uses.
drop policy if exists "job_photos_read" on storage.objects;
create policy "job_photos_read" on storage.objects for select to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1 from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
    where j.id::text = (storage.foldername(name))[1]
      and c.organization_id = current_org_id()
  )
);

drop policy if exists "job_photos_write" on storage.objects;
create policy "job_photos_write" on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-photos'
  and exists (
    select 1 from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
    where j.id::text = (storage.foldername(name))[1]
      and c.organization_id = current_org_id()
  )
);

drop policy if exists "job_photos_delete" on storage.objects;
create policy "job_photos_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1 from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
    where j.id::text = (storage.foldername(name))[1]
      and c.organization_id = current_org_id()
  )
);

notify pgrst, 'reload schema';
