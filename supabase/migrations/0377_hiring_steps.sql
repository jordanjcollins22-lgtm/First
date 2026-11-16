-- The hiring steps between the first interview and the hire: a paid half-day
-- working interview, the owner talk, then the offer. "hired" now means they
-- said yes to the offer.
alter table public.job_applicants drop constraint if exists job_applicants_stage_check;
alter table public.job_applicants add constraint job_applicants_stage_check check (stage in (
  'screened_out', 'video_requested', 'video_submitted', 'interview',
  'working_interview', 'owner_talk', 'offer_sent',
  'hired', 'not_a_fit', 'withdrawn'
));
