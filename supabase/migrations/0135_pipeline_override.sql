-- Moving a job on the board by hand.
--
-- The stage is derived from what is already true — the job's status, its
-- evaluation, its proposal — and that is right nearly always. Nearly. A
-- client says yes on the phone and the proposal is still sitting at "sent";
-- an evaluation happened but nobody pressed the button; work started early as
-- a favour. In those the board is wrong and there is nothing to correct it
-- with, because the thing that would correct it is the paperwork that has not
-- caught up.
--
-- So a job can be placed by hand. What is stored is not the stage on its own
-- but the stage *and the derived answer it was overriding* — so the moment
-- the underlying facts move, the override is known to be about a situation
-- that no longer exists and the automatic answer takes back over. An override
-- that outlives its reason is the stored-status problem all over again.

alter table jobs add column if not exists pipeline_override_stage text;
alter table jobs add column if not exists pipeline_override_status text;
-- The derived status at the moment somebody moved it. The staleness check.
alter table jobs add column if not exists pipeline_override_from text;
alter table jobs add column if not exists pipeline_override_at timestamptz;
alter table jobs add column if not exists pipeline_override_by uuid references profiles(id) on delete set null;
alter table jobs add column if not exists pipeline_override_note text;

comment on column jobs.pipeline_override_from is
  'What the pipeline would have said when the job was moved by hand. When the derived answer stops matching this, the move is about a situation that has passed and the automatic position wins again.';

notify pgrst, 'reload schema';
