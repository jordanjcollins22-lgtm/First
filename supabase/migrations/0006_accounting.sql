-- ============================================================
-- Bookkeeping for Schedule C.
--
-- accounting_accounts      : bank/credit-card accounts (CSV or Plaid-linked).
-- bank_connections         : a linked bank login (Plaid item). No secrets.
-- bank_connection_secrets  : Plaid access token + sync cursor. Service role only.
-- accounting_transactions  : every statement line, with its Schedule C category.
-- accounting_rules         : "always put <merchant> in <category>" decisions.
-- accounting_year_settings : per-tax-year inventory counts, tax rates and the
--                            plant sell-vs-install choice.
-- accounting_imports       : log of CSV uploads (what came from where).
-- ============================================================

create table if not exists bank_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'plaid' check (provider in ('plaid')),
  item_id text not null unique,
  institution_name text,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kept apart so the access token is never readable with the anon key.
create table if not exists bank_connection_secrets (
  connection_id uuid primary key references bank_connections(id) on delete cascade,
  access_token text not null,
  sync_cursor text,
  updated_at timestamptz not null default now()
);

create table if not exists accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'checking' check (kind in ('checking', 'savings', 'credit_card', 'other')),
  source text not null default 'csv' check (source in ('csv', 'plaid')),
  institution text,
  mask text,
  connection_id uuid references bank_connections(id) on delete set null,
  plaid_account_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounting_accounts(id) on delete cascade,
  -- Plaid transaction_id, or a hash-like key for CSV rows. Dedupes re-imports.
  external_id text not null,
  posted_on date not null,
  description text not null,
  merchant_name text,
  -- Positive = money in, negative = money out.
  amount numeric(14, 2) not null,
  category text not null default 'uncategorized',
  category_source text not null default 'default'
    check (category_source in ('default', 'rule', 'user_rule', 'ai', 'manual')),
  confidence numeric(3, 2),
  needs_review boolean not null default true,
  categorization_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, external_id)
);

create index if not exists accounting_transactions_posted_idx on accounting_transactions (posted_on);
create index if not exists accounting_transactions_review_idx on accounting_transactions (needs_review, posted_on);
create index if not exists accounting_transactions_category_idx on accounting_transactions (category, posted_on);

create table if not exists accounting_rules (
  id uuid primary key default gen_random_uuid(),
  match_text text not null unique,
  category text not null,
  created_at timestamptz not null default now()
);

create table if not exists accounting_year_settings (
  tax_year integer primary key,
  beginning_inventory numeric(14, 2) not null default 0,
  ending_inventory numeric(14, 2) not null default 0,
  sales_tax_rate numeric(6, 4) not null default 0.07,
  sales_tax_paid_on_materials boolean not null default true,
  plant_markup numeric(6, 2) not null default 2,
  federal_marginal_rate numeric(5, 4) not null default 0.22,
  state_income_rate numeric(5, 4) not null default 0.05,
  qbi_deduction boolean not null default true,
  plant_treatment text check (plant_treatment in ('sell', 'install')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounting_accounts(id) on delete cascade,
  filename text,
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['bank_connections', 'bank_connection_secrets', 'accounting_accounts', 'accounting_transactions', 'accounting_year_settings']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

alter table bank_connections enable row level security;
alter table bank_connection_secrets enable row level security;
alter table accounting_accounts enable row level security;
alter table accounting_transactions enable row level security;
alter table accounting_rules enable row level security;
alter table accounting_year_settings enable row level security;
alter table accounting_imports enable row level security;

-- Same MVP policy as the rest of the schema, except bank_connection_secrets:
-- it gets no policy at all, so only the service-role key can read it.
do $$
declare
  t text;
begin
  foreach t in array array['bank_connections', 'accounting_accounts', 'accounting_transactions', 'accounting_rules', 'accounting_year_settings', 'accounting_imports']
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;
