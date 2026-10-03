-- Saying there isn't a photo.
--
-- Every zone owes a before, a during and an after, and 'during' is the one
-- nobody can go back for once the ground is closed up. But sometimes there
-- genuinely isn't one — the work was an hour long, or it rained, or the crew
-- arrived to find it already done.
--
-- Without somewhere to say so, the only ways out were to leave the job
-- looking unfinished forever or to upload something that is not what it
-- claims to be. This is the third way: a record that a person said there is
-- no photo, with their name on it.

create table if not exists job_photo_waivers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,

  -- Null is the job-wide bucket, the same as job_photos.
  zone_id text,
  stage text not null check (stage in ('before', 'during', 'after')),

  reason text,
  waived_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  -- One waiver per stage per zone. Saying it twice is still saying it once.
  unique (job_id, zone_id, stage)
);

create index if not exists job_photo_waivers_job_idx on job_photo_waivers(job_id);

alter table job_photo_waivers enable row level security;

-- Same audience as the photos themselves: whoever can add a photo to a job
-- can say there isn't one, because they are the person standing there.
drop policy if exists "org_scoped_job_photo_waivers" on job_photo_waivers;
create policy "org_scoped_job_photo_waivers" on job_photo_waivers for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
