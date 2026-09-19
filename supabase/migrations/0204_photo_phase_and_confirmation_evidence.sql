-- A photo from the evaluation is not a photo of what the crew found.
--
-- Both used to be kind='before', so the pre-start check could be satisfied by
-- a photograph taken weeks earlier at the evaluation. That is exactly the
-- record the check exists to force: what the ground looked like the morning
-- somebody arrived, before they touched it. So photos carry the phase they
-- were taken in, and the readiness checks read that and never the kind:
--
--   evaluation  taken while quoting the work
--   prework     taken on arrival, before the crew starts
--   progress    taken during the work
--   after       taken when it is finished
--   issue       taken to show a problem or damage
--
-- Existing rows are backfilled from the kind, and every existing 'before' row
-- becomes 'evaluation'. That is the cautious direction and it is deliberate:
-- it means no job in flight can be started on the strength of an old photo.
-- Where a visit is known, work_session_id says which one.
--
-- job_confirmations also gains how the thing was secured -- on hand, ordered,
-- delivery confirmed, assigned -- and when an ordered item is expected, so a
-- confirmation resting on a delivery can be checked against the start date
-- rather than being taken on trust.

ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS work_session_id UUID;

DO $do$ BEGIN
  ALTER TABLE public.job_photos
    ADD CONSTRAINT job_photos_phase_check
    CHECK (phase IS NULL OR phase IN ('evaluation','prework','progress','after','issue'));
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE public.job_photos
    ADD CONSTRAINT job_photos_work_session_fkey FOREIGN KEY (work_session_id)
    REFERENCES public.job_work_sessions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

UPDATE public.job_photos SET phase = 'evaluation' WHERE phase IS NULL AND kind = 'before';
UPDATE public.job_photos SET phase = 'progress' WHERE phase IS NULL AND kind = 'during';
UPDATE public.job_photos SET phase = 'after' WHERE phase IS NULL AND kind = 'after';

CREATE INDEX IF NOT EXISTS job_photos_phase_idx ON public.job_photos (job_id, phase);
CREATE INDEX IF NOT EXISTS job_photos_session_idx ON public.job_photos (work_session_id);

ALTER TABLE public.job_confirmations ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE public.job_confirmations ADD COLUMN IF NOT EXISTS expected_available_on DATE;

DO $do$ BEGIN
  ALTER TABLE public.job_confirmations
    ADD CONSTRAINT job_confirmations_method_check
    CHECK (method IS NULL OR method IN ('on_hand','ordered','delivery_confirmed','assigned','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

NOTIFY pgrst, 'reload schema';
