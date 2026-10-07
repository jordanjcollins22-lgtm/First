-- Three things the graph could not say.
--
-- What a unit is, when it is not one of ours. How much one of something does,
-- so "two thousand door hangers" can work out how many sheets that is instead
-- of somebody doing it in their head every time. And what it costs when the
-- answer is a cheque to another company rather than a pile of materials.

-- ============================================================
-- Units somebody typed themselves
-- ============================================================
-- The built-in list is a good start and a bad ceiling. A business that buys
-- sod by the pallet, mulch by the scoop and printing by the thousand should
-- not have to pick "each" and remember what it meant.
create table if not exists knowledge_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- What one of it is called: "pallet", "scoop", "thousand".
  name text not null,
  plural text,

  -- Hours in one, where the unit is a unit of somebody's time. Null means it
  -- is a thing rather than a stretch of somebody's day, which is what keeps
  -- money and hours in separate columns.
  hours numeric check (hours is null or hours > 0),

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  unique (organization_id, name)
);

create index if not exists knowledge_units_org_idx on knowledge_units(organization_id, name);

alter table knowledge_units enable row level security;

drop policy if exists "org_scoped_knowledge_units" on knowledge_units;
create policy "org_scoped_knowledge_units" on knowledge_units for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ============================================================
-- How much one of it does
-- ============================================================
-- A bag covers a hundred square feet. A sheet makes one door hanger. A drum
-- does eight driveways. Knowing that turns "how many do I need" from a sum
-- somebody does in their head into one the app does the same way every time.
alter table knowledge_nodes add column if not exists output_per_unit numeric
  check (output_per_unit is null or output_per_unit > 0);
alter table knowledge_nodes add column if not exists output_unit text;

comment on column knowledge_nodes.output_per_unit is
  'How much one unit of this does — 100 sq ft to a bag, 1 hanger to a sheet. Read with output_unit.';

-- And what one run of an idea produces, so the two can be divided.
alter table knowledge_nodes add column if not exists run_size numeric
  check (run_size is null or run_size > 0);
alter table knowledge_nodes add column if not exists run_unit text;

comment on column knowledge_nodes.run_size is
  'For an idea: how much one run of it produces — 2,000 hangers, 40 driveways. Divided by an input''s output_per_unit to work out how many are needed.';

-- ============================================================
-- Money that goes to somebody else
-- ============================================================
-- Not everything is a material with a unit price. A mailing house charges
-- four hundred and fifty a drop whether the drop is two thousand pieces or
-- three, and multiplying that by a quantity would be wrong in both directions.
alter table knowledge_nodes add column if not exists fixed_cost numeric
  check (fixed_cost is null or fixed_cost >= 0);

comment on column knowledge_nodes.fixed_cost is
  'A flat price, charged once per use rather than per unit — a subcontractor, a permit, a delivery fee. Kept apart from materials and hours in every total.';

notify pgrst, 'reload schema';
