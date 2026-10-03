-- Invoices, as files, against the person they were sent to.
--
-- Bills get written in accounting software, sent as PDFs, and then live in an
-- inbox. The office needs them where the client is: what we billed them, when
-- it was due, and whether it came in. A folder full of PDFs named
-- "invoice_final_2.pdf" answers none of that.
--
-- Deliberately not archived_proposals. A quote is an offer and what matters
-- about it is whether we won it; an invoice is a debt and what matters is
-- whether it was paid and when it was due. Folding them together would mean a
-- row with an outcome that has no meaning and a due date that has none either.
--
-- Deliberately not payments. That table is money that actually arrived and has
-- to reconcile with the bank. An invoice is money we asked for, which is a
-- different claim -- an unpaid one is real and belongs on the client's record,
-- and putting it in payments would make every total in the app wrong.

create table if not exists client_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id uuid not null references customers(id) on delete cascade,

  -- Where the file sits in the invoices bucket.
  file_path text not null,
  file_name text not null,

  -- What the accounting software called it. Searchable, because "which one
  -- was invoice 1042" is the question somebody actually arrives with.
  invoice_number text,

  amount numeric,

  -- When it was sent and when it was due. Status is read off these and the
  -- date below rather than stored: a stored 'overdue' is a second thing to
  -- keep in step, and it starts lying the morning after the due date.
  issued_on date,
  due_on date,
  -- The day the money came in. Null means still outstanding, which is the
  -- one fact worth storing -- it happened in the world rather than being a
  -- state we work out.
  paid_on date,

  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_invoices_customer_idx
  on client_invoices (customer_id, issued_on desc);
-- The list somebody chases from: everything still owed, oldest first.
create index if not exists client_invoices_outstanding_idx
  on client_invoices (organization_id, due_on) where paid_on is null;
create index if not exists client_invoices_number_idx
  on client_invoices (organization_id, invoice_number);

alter table client_invoices enable row level security;
drop policy if exists "org_scoped_client_invoices" on client_invoices;
create policy "org_scoped_client_invoices" on client_invoices for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Private, for the same reason the proposal archive is. An invoice carries a
-- client's name, their address and what they were charged, and a public
-- bucket is one guessed URL away from being a filing cabinet anybody can
-- read. Signed links only, minted per view for somebody signed in.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "team_read_invoices" on storage.objects;
create policy "team_read_invoices"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoices');

drop policy if exists "team_write_invoices" on storage.objects;
create policy "team_write_invoices"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices');

drop policy if exists "team_delete_invoices" on storage.objects;
create policy "team_delete_invoices"
  on storage.objects for delete to authenticated
  using (bucket_id = 'invoices');

notify pgrst, 'reload schema';
