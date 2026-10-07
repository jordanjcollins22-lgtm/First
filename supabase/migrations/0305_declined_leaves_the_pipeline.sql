-- Declined leaves the pipeline.
--
-- It was the last column of Sales, where it sat among live quotes and its
-- money was counted as quoted and not yet won. It is its own section now,
-- under the board. Jobs placed there by hand said "sales"; they say
-- "declined". The app also reads the old spelling as the new one, so this
-- only tidies what is stored.
UPDATE public.jobs
SET pipeline_override_stage = 'declined'
WHERE pipeline_override_stage = 'sales' AND pipeline_override_status = 'Declined';
