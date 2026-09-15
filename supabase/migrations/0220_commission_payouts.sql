-- Commission actually handed over.
--
-- The engine already worked out what an account manager had earned, held or
-- was accruing. What nobody could answer was "has that one been paid", and
-- the answer was living in somebody's memory and a bank statement.
--
-- One row per job per payment, not one per cheque. A lump covering six jobs
-- is six rows sharing a reference, because the question is always about a
-- job: an account manager looking at a project wants to know whether that
-- project's commission has reached them.
--
-- An amount rather than a flag, because commission grows with what is
-- collected. Eight hundred comes in, the commission on it is paid, then
-- another four hundred arrives and the job owes again. A flag would say
-- settled and be wrong.
create table if not exists commission_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text,
  -- The cheque number, the transfer reference, the payroll run. Whatever
  -- somebody would look for on a statement.
  reference text,
  note text,
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table commission_payouts is
  'Commission actually handed over, one row per job per payment. A lump covering six jobs is six rows sharing a reference, because "has that one been paid" is a question about a job.';

create index if not exists commission_payouts_person_idx
  on commission_payouts (profile_id, paid_at desc);
create index if not exists commission_payouts_job_idx
  on commission_payouts (job_id);

alter table commission_payouts enable row level security;

drop policy if exists commission_payouts_own_org on commission_payouts;
create policy commission_payouts_own_org on commission_payouts
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
