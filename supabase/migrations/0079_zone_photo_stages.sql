-- Photos per zone, at three stages.
--
-- 0078 gave a job one pile of photos. That is enough to prove somebody stood
-- on the finished site, and not enough to prove anything about a particular
-- piece of work: a patio, a bed rebuild and a drainage run all end up in the
-- same pile, and the one zone nobody photographed is invisible.
--
-- 'during' joins before/after because it is the stage that actually settles
-- arguments — what the ground looked like once it was open, what was under the
-- old bed, how deep the base went. Nobody can go back for it later.

-- The stage a photo shows. 'issue' stays: a problem found on site is worth
-- recording and is not a stage of the work.
alter table job_photos drop constraint if exists job_photos_kind_check;
alter table job_photos add constraint job_photos_kind_check
  check (kind in ('before', 'during', 'after', 'issue'));

-- Which zone it belongs to. Text, not a foreign key: zones live inside the
-- canvas design's jsonb and have no table of their own. Null means the photo
-- is about the job as a whole rather than one zone, which is what every photo
-- taken before this migration was.
alter table job_photos add column if not exists zone_id text;
-- The zone's name as it was when the photo was taken. Denormalised on purpose:
-- zones get renamed and deleted, and a photo whose zone is gone should still
-- say what it was of rather than becoming an orphan nobody can place.
alter table job_photos add column if not exists zone_name text;

create index if not exists job_photos_zone_idx on job_photos(job_id, zone_id);

notify pgrst, 'reload schema';
