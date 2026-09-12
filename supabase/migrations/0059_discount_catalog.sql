-- A reusable catalog of discounts (percentage or flat dollar amount) an
-- account manager picks from when editing a proposal, instead of typing an
-- arbitrary number each time. Org-scoped so each business builds its own
-- list; anyone on the team can add a new one on the fly from the proposal
-- editor if the one they need doesn't exist yet.

create table if not exists discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  kind text not null check (kind in ('percentage', 'amount')),
  value numeric not null check (value > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on discounts;
create trigger set_updated_at before update on discounts for each row execute function set_updated_at();

alter table discounts enable row level security;
drop policy if exists "org_scoped_discounts" on discounts;
create policy "org_scoped_discounts" on discounts for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Which catalog discount (if any) is applied to a proposal, and its kind/value
-- at the time it was applied — discount_amount stays the resolved dollar
-- figure (kept from the previous migration) so display code doesn't need to
-- recompute percentage-of-subtotal every render.
alter table job_proposals add column if not exists discount_id uuid references discounts(id);
alter table job_proposals add column if not exists discount_kind text check (discount_kind in ('percentage', 'amount'));
alter table job_proposals add column if not exists discount_value numeric;
