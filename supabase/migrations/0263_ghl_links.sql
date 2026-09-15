-- Where a booking lives in GoHighLevel.
--
-- An evaluation booked in the app is put on the GoHighLevel calendar as
-- well, so the office sees one calendar wherever they look. The ids that
-- come back are kept on the job and the client, so a move or a
-- cancellation updates the same appointment instead of making another,
-- and so the GoHighLevel webhook can tell our own booking coming back
-- round from a new one.

alter table jobs add column if not exists ghl_appointment_id text;
alter table customers add column if not exists ghl_contact_id text;

create index if not exists jobs_ghl_appointment_idx on jobs(ghl_appointment_id) where ghl_appointment_id is not null;
