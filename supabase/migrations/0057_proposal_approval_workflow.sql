-- Proposals now auto-generate the moment an evaluation is submitted, so an
-- account manager's only input is to edit or approve one — not click a
-- "Generate" button. That means a new state has to exist before a proposal
-- is visible to the client at all: "needs_approval" (just generated, an AM
-- hasn't reviewed it yet) -> "sent" (approved, now live on the public link)
-- -> "accepted"/"declined" (the client responded), same as before.
--
-- Existing "pending" rows were already generated-and-visible under the old
-- flow, so they map to "sent", not "needs_approval".

alter table job_proposals drop constraint if exists job_proposals_status_check;
update job_proposals set status = 'sent' where status = 'pending';
alter table job_proposals add constraint job_proposals_status_check
  check (status in ('needs_approval', 'sent', 'accepted', 'declined'));
alter table job_proposals alter column status set default 'needs_approval';

alter table job_proposals add column if not exists approved_at timestamptz;
