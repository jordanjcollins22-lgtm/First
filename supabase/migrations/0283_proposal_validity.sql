-- A proposal stands for seven or fourteen days, then closes on its own.
alter table job_proposals add column if not exists valid_days integer not null default 14
  check (valid_days in (7, 14));
alter table job_proposals add column if not exists expires_at timestamptz;

-- Everything still out gets the default life from the day it was sent. Only
-- the sent ones: an accepted or declined proposal has no clock to run, and
-- touching every row would trip the price check on the one old $0 contract.
update job_proposals
set expires_at = approved_at + (valid_days || ' days')::interval
where status = 'sent' and approved_at is not null and expires_at is null;

create index if not exists job_proposals_expiry_idx on job_proposals (expires_at) where status = 'sent';
