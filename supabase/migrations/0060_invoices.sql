-- A payable Stripe invoice, created automatically the moment a client
-- accepts a proposal (see respondToProposal / createAndSendInvoice). Stripe
-- hosts the actual payment page and PDF — this table is just our record of
-- it and tracks paid/void status via the Stripe webhook.

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  job_id uuid not null references jobs(id) unique,
  proposal_id uuid references job_proposals(id),
  amount numeric not null,
  status text not null default 'open' check (status in ('open', 'paid', 'void', 'uncollectible')),
  stripe_customer_id text,
  stripe_invoice_id text unique,
  hosted_invoice_url text,
  invoice_pdf text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on invoices;
create trigger set_updated_at before update on invoices for each row execute function set_updated_at();

alter table invoices enable row level security;
drop policy if exists "org_scoped_invoices" on invoices;
create policy "org_scoped_invoices" on invoices for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
