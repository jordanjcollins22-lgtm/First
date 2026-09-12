-- Taking money: one-off, in instalments, or on a subscription.
--
-- And, first, fixing the thing that stopped any of it reconciling. Invoicing
-- called Stripe's customers.create every single time, so one contact of ours
-- ended up as five or six customers of Stripe's. Nothing could be tied back
-- to a person, which is exactly what "reconcile payments with our contacts"
-- means.

-- ---------------------------------------------------------------------------
-- One contact, one Stripe customer
-- ---------------------------------------------------------------------------
alter table customers add column if not exists stripe_customer_id text;

comment on column customers.stripe_customer_id is
  'This contact in Stripe. Found or created once and reused — a second customer for the same person is a payment that reconciles to nobody.';

create unique index if not exists customers_stripe_id_idx
  on customers(stripe_customer_id) where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------
-- The plan somebody agreed to
-- ---------------------------------------------------------------------------
create table if not exists payment_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  proposal_id uuid references job_proposals(id) on delete set null,
  customer_id uuid not null references customers(id) on delete cascade,

  kind text not null check (kind in ('one_time', 'instalments', 'subscription')),

  -- Whole cents, always. A total in dollars is a float, and a float is how a
  -- customer ends up a penny short of paid off forever.
  total_cents bigint not null check (total_cents > 0),
  deposit_cents bigint not null default 0 check (deposit_cents >= 0),
  instalments int check (instalments is null or instalments between 1 and 60),
  interval text check (interval in ('weekly', 'monthly', 'quarterly', 'yearly')),

  -- offered  — sent to the customer, not yet agreed
  -- accepted — they said yes; the schedule below is now owed
  -- active   — money has started arriving
  -- settled  — paid off
  -- cancelled
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'active', 'settled', 'cancelled')),

  accepted_at timestamptz,
  -- Who accepted. A client accepting from a link has no account, so this is
  -- null for them and set when somebody in the office does it for them.
  accepted_by uuid references profiles(id),

  stripe_subscription_id text unique,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_plans_job_idx on payment_plans(job_id);
create index if not exists payment_plans_customer_idx on payment_plans(customer_id, created_at desc);
create index if not exists payment_plans_org_idx on payment_plans(organization_id, status);

alter table payment_plans enable row level security;
drop policy if exists "org_scoped_payment_plans" on payment_plans;
create policy "org_scoped_payment_plans" on payment_plans for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- The payments the plan is made of
-- ---------------------------------------------------------------------------
-- Written out at acceptance rather than worked out on the fly. What somebody
-- agreed to pay is a fact about a moment, and a schedule recomputed from a
-- total that later changed is a schedule nobody agreed to.
create table if not exists payment_plan_instalments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references payment_plans(id) on delete cascade,

  number int not null check (number > 0),
  amount_cents bigint not null check (amount_cents > 0),
  due_on date not null,
  is_deposit boolean not null default false,

  status text not null default 'due'
    check (status in ('due', 'paid', 'failed', 'cancelled')),

  stripe_invoice_id text unique,
  stripe_payment_intent_id text,
  hosted_url text,
  paid_at timestamptz,

  created_at timestamptz not null default now(),

  unique (plan_id, number)
);

create index if not exists payment_plan_instalments_plan_idx
  on payment_plan_instalments(plan_id, number);
-- What is due and unpaid, which is the only query the chasing screen makes.
create index if not exists payment_plan_instalments_due_idx
  on payment_plan_instalments(due_on) where status = 'due';

alter table payment_plan_instalments enable row level security;
drop policy if exists "org_scoped_plan_instalments" on payment_plan_instalments;
create policy "org_scoped_plan_instalments" on payment_plan_instalments for all to authenticated
  using (
    exists (
      select 1 from payment_plans p
      where p.id = payment_plan_instalments.plan_id and p.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from payment_plans p
      where p.id = payment_plan_instalments.plan_id and p.organization_id = current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Money that actually arrived
-- ---------------------------------------------------------------------------
-- Every payment, against the contact it came from. This is the reconciliation:
-- Stripe tells us a customer paid, and because a contact now has exactly one
-- Stripe customer, that resolves to a person rather than to an id.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  plan_id uuid references payment_plans(id) on delete set null,
  instalment_id uuid references payment_plan_instalments(id) on delete set null,

  amount_cents bigint not null,
  currency text not null default 'usd',

  -- 'card' through Stripe, or cash and cheque somebody logged by hand.
  method text not null default 'card' check (method in ('card', 'cash', 'check', 'other')),

  -- Unique so a webhook delivered twice records one payment. Stripe retries
  -- on any non-2xx, and a duplicate payment row is a customer who appears to
  -- have paid twice.
  stripe_payment_intent_id text unique,
  stripe_invoice_id text,

  received_at timestamptz not null default now(),
  note text,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists payments_customer_idx on payments(customer_id, received_at desc);
create index if not exists payments_job_idx on payments(job_id);
create index if not exists payments_org_idx on payments(organization_id, received_at desc);

alter table payments enable row level security;
drop policy if exists "org_scoped_payments" on payments;
create policy "org_scoped_payments" on payments for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
