-- What the crew had to buy on a job.
--
-- Materials are ordered ahead, so this is the exception: the bag of mulch
-- that ran short, the part that broke. Whoever bought it adds a photo or a
-- screenshot of the receipt from the crew sheet, with what it was for, and
-- the office sees it on the job. The image lives in the job-photos bucket
-- under the job's folder, so the bucket's own policies cover it.

create table if not exists job_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  -- Path inside the job-photos bucket; the first segment is the job id.
  path text not null unique,
  -- What was bought, in their words.
  what text not null check (length(btrim(what)) > 0),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists job_receipts_job_idx on job_receipts (job_id, created_at desc);

alter table job_receipts enable row level security;
drop policy if exists job_receipts_own_org on job_receipts;
create policy job_receipts_own_org on job_receipts
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
