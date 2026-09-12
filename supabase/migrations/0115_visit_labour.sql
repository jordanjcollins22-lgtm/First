-- Who worked on a visit, and for how long.
--
-- A visit said when it was and what it was for. It never said who turned up
-- or how long they were there, which is the half that decides what the job
-- actually cost.
--
-- Not a new table. The clock already records who worked and for how long;
-- what it did not record was which visit the work belonged to. A second place
-- to write down hours would be a second set of hours to disagree with the
-- first, and payroll would have to pick one.

alter table time_entries add column if not exists session_id uuid
  references job_work_sessions(id) on delete set null;

comment on column time_entries.session_id is
  'The visit this work belongs to. Null for hours against a job with no visit, or against no job at all.';

create index if not exists time_entries_session_idx
  on time_entries(session_id) where session_id is not null;

notify pgrst, 'reload schema';
