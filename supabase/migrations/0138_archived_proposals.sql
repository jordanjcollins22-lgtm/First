-- The proposals that were written before this app existed.
--
-- Years of quotes live in the old CRM as PDFs. Carrying them across is worth
-- doing for two reasons, and the second is the bigger one. A client's record
-- should say what we have already quoted them, so nobody re-quotes a job we
-- lost on price last spring without knowing. And the ones we did not win are
-- a list: every one is somebody who wanted the work, got a number, and said
-- no or said nothing.
--
-- Deliberately not job_proposals. Those are generated from a site map, carry
-- a scope snapshot and a token a client can open, and every one of them is
-- live paperwork. These are documents about work that is already over. Trying
-- to make one table serve both would mean a job_proposals row with no job, no
-- scope and no token, which is three lies to store one PDF.

create table if not exists archived_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id uuid not null references customers(id) on delete cascade,
  -- Where the PDF sits in the proposal-archive bucket.
  file_path text not null,
  file_name text not null,
  -- won, lost or disputed. What actually happened, which is the whole reason
  -- to carry these over rather than leave them in the old system.
  outcome text not null check (outcome in ('won', 'lost', 'disputed')),
  -- When the work was done, or was going to be. Not when the file was made:
  -- a quote written in March for an April job belongs in April.
  job_date date,
  -- What the job was, in a few words, so a list of eleven PDFs is readable.
  title text,
  amount numeric,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists archived_proposals_customer_idx
  on archived_proposals (customer_id, job_date desc);
-- The list phase two works from: everything we quoted and did not win.
create index if not exists archived_proposals_outcome_idx
  on archived_proposals (organization_id, outcome);

alter table archived_proposals enable row level security;
drop policy if exists "org_scoped_archived_proposals" on archived_proposals;
create policy "org_scoped_archived_proposals" on archived_proposals for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Private, unlike the image buckets. These carry a client's name, address and
-- what they were charged, and a public bucket is a public URL away from being
-- a filing cabinet anybody can read. Signed links only, and only for someone
-- signed in.
insert into storage.buckets (id, name, public)
values ('proposal-archive', 'proposal-archive', false)
on conflict (id) do nothing;

drop policy if exists "team_read_proposal_archive" on storage.objects;
create policy "team_read_proposal_archive"
  on storage.objects for select to authenticated
  using (bucket_id = 'proposal-archive');

drop policy if exists "team_write_proposal_archive" on storage.objects;
create policy "team_write_proposal_archive"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'proposal-archive');

drop policy if exists "team_delete_proposal_archive" on storage.objects;
create policy "team_delete_proposal_archive"
  on storage.objects for delete to authenticated
  using (bucket_id = 'proposal-archive');

notify pgrst, 'reload schema';
