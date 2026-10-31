-- The estimate a client gets the moment they finish the map pre-evaluation.
--
-- Booking leads straight into the map: they tap the spots they want worked
-- on, say what for, and add photos. Their taps fill in the pre-evaluation
-- answers (evaluation_intakes), and from those the instant price is worked
-- and kept here, with the spots themselves. It is an estimate: the visit
-- confirms it, and the proposal after the visit is the price. A third of it
-- down holds the job, paid by card and recorded against the job like any
-- other payment, so the proposal's pay page asks only for the rest.
--
-- One per job. Reached by the evaluation_intakes token, so the client's one
-- link covers the form, the map and the estimate.
create table if not exists job_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null unique references jobs(id) on delete cascade,
  -- [{ lng, lat, choices: [...], photos: [job-photos path] }], as tapped.
  spots jsonb not null default '[]',
  -- The InstantPrice the total was worked from: lines, sizes, rates.
  price jsonb not null,
  total_cents integer not null check (total_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  -- Pressed Accept and was sent to pay the deposit.
  accepted_at timestamptz,
  checkout_session_id text,
  -- The deposit landed (Stripe webhook).
  deposit_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_estimates_org_idx on job_estimates (organization_id, created_at desc);

alter table job_estimates enable row level security;

drop policy if exists job_estimates_own_org on job_estimates;
create policy job_estimates_own_org on job_estimates
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

comment on table job_estimates is
  'The instant estimate a client sees after the map pre-evaluation, and its one-third deposit. One per job, reached by the evaluation_intakes token.';
