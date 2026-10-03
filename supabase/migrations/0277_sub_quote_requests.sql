-- A price request to a subcontractor, one per service on a job.
--
-- A proposal has a soft-washing part and the business has a soft washer.
-- Until now getting their number meant screenshots and a text. Now the
-- office makes a link for that service: what we want done in each area,
-- in our words, with the photos, and a box for the contractor's price.
-- Nothing about zones, nothing about the client, nothing about the rest of
-- the job. The areas are copied in at creation so a proposal edited later
-- does not change what somebody already priced.

create table if not exists sub_quote_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  token text not null unique,
  service_label text not null,
  -- [{ "scopeText": "...", "photoPaths": ["..."] }, ...]
  areas jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'open' check (status in ('open', 'quoted', 'closed')),
  contractor_name text,
  contractor_phone text,
  contractor_email text,
  quote_amount numeric(10, 2),
  quote_note text,
  quoted_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sub_quote_requests_job_idx on sub_quote_requests (job_id, created_at desc);

alter table sub_quote_requests enable row level security;
drop policy if exists "sub_quote_requests_org" on sub_quote_requests;
create policy "sub_quote_requests_org" on sub_quote_requests for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
