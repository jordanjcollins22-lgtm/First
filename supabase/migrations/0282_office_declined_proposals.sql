-- A job declined by the office closes its proposals too.
--
-- Moving a job to Declined on the pipeline set a date on the job and left the
-- proposal saying "sent" or "needs approval", so the proposals list, the call
-- list and the client's own page all went on treating it as live. Who closed
-- it and what it said before are kept, so taking the decline back can put the
-- proposal back exactly where it was.
alter table job_proposals add column if not exists office_declined_by uuid references profiles(id) on delete set null;
alter table job_proposals add column if not exists office_declined_from text
  check (office_declined_from is null or office_declined_from in ('needs_approval', 'sent'));

-- Proposals still open on jobs the office had already declined.
update job_proposals p
set office_declined_from = p.status,
    office_declined_by = j.declined_by,
    status = 'declined',
    responded_at = coalesce(p.responded_at, j.declined_at),
    updated_at = now()
from jobs j
where j.id = p.job_id
  and j.declined_at is not null
  and p.status in ('needs_approval', 'sent');
