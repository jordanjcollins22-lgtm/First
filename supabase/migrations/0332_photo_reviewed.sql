-- A crew photo the account manager has looked at and said is fine, one photo
-- at a time, from Projects today on My Day. Redo is a touch-up mark with a
-- note, the way the punch list already works, so it reaches the crew the same
-- way.
alter table public.job_photos
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

create index if not exists job_photos_to_review on public.job_photos (job_id, created_at) where reviewed_at is null;
