-- CATCH-UP: everything outstanding, in order, as one paste.
-- Run in Supabase's SQL Editor. Every statement is idempotent — running
-- it twice, or when some are already applied, is safe.

-- ==========================================================
-- 0087_referral_outcome.sql
-- ==========================================================
-- Contacting somebody who will never buy from us, on purpose.
--
-- Most of a county is not our target market — small lots, rentals, people who
-- do their own yard. The instinct is to skip them. But the person with the
-- quarter-acre knows the neighbour with the three acres, and asking them is
-- free, so "not for you" is not the end of a call, it is the middle of one.
--
-- That needed an outcome of its own. Logged as "not interested", a call that
-- produced a name looks identical to one that produced nothing, and the whole
-- point of working the rest of the county disappears from the numbers.

alter table outreach_touches drop constraint if exists outreach_touches_outcome_check;
alter table outreach_touches add constraint outreach_touches_outcome_check
  check (outcome in (
    'attempted',
    'reached',
    'interested',
    'booked',
    'referral_received',
    'not_interested',
    'do_not_contact'
  ));

-- Whether this property is one we would ever work at.
--
-- Kept separate from status, which is about our progress with them. A parcel
-- can be out of market and still be worth a call, and conflating the two is
-- how "not our market" turns into "never ring them".
alter table lead_prospects add column if not exists in_target_market boolean;

comment on column lead_prospects.in_target_market is
  'Null until somebody decides. False means we would not work here, which is a reason to ask them who they know rather than a reason to skip them.';

-- Who they pointed us at, when they gave us a name. Free text: a referral is
-- "my sister on Vale Road", not a structured record.
alter table outreach_touches add column if not exists referral_note text;

notify pgrst, 'reload schema';

-- ==========================================================
-- 0088_contact_types.sql
-- ==========================================================
-- Not everybody in the contact book is a client.
--
-- There has only ever been one shelf for a person, and twenty-eight places in
-- the app read a row on it as "a client of ours". That was fine while the only
-- way in was somebody booking an evaluation. It stops being fine the moment a
-- CRM export arrives carrying the stone yard, the tree crew and the realtor
-- who sends work — because they would land in every client picker, every count
-- of our clients, and on the coverage map as somebody we have already sold to.
--
-- So a contact gets a type, and everything that means "our clients" says so
-- explicitly rather than by assuming.

alter table customers add column if not exists contact_type text not null default 'client'
  check (contact_type in ('client', 'lead', 'supplier', 'subcontractor', 'referral_partner', 'other'));

-- Where the row came from, so a bad import can be found and undone whole. The
-- same reasoning as source_batch on the prospect list.
alter table customers add column if not exists source text;
alter table customers add column if not exists import_batch text;

-- The CRM's own id. Re-importing the same export updates rather than
-- duplicating, which matters because nobody imports a contact database once.
alter table customers add column if not exists external_id text;

create unique index if not exists customers_external_id_idx
  on customers(organization_id, external_id)
  where external_id is not null;

-- Kept because losing it is the one mistake that cannot be walked back: a
-- person who opted out of being contacted, contacted again.
alter table customers add column if not exists do_not_contact boolean not null default false;

-- How the CRM organised them. Free-form and preserved as-is, because a tag is
-- somebody's own filing system and re-interpreting it loses information.
alter table customers add column if not exists tags text[];

-- The address as it arrived, before anybody geocoded it.
--
-- A property row needs coordinates, and a CRM address is often partial ("Bel
-- Air, MD") or missing. Rather than making properties.lat nullable and
-- rippling that through every screen that draws a map, the raw text is parked
-- here and a property is created only once it resolves to a real point.
alter table customers add column if not exists import_address text;

create index if not exists customers_contact_type_idx on customers(organization_id, contact_type);

comment on column customers.contact_type is
  'client and lead are people who might buy. supplier, subcontractor and referral_partner are the trade. other is undecided — kept out of client lists until somebody says.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0089_job_numbers_and_pipeline.sql
-- ==========================================================
-- Every project gets a number somebody can say out loud.
--
-- A job has only ever had a uuid, which is fine for a database and useless on
-- a phone call. "Job 1042" is something a client can quote back, a crew can
-- write on a sheet, and two people can agree they are talking about the same
-- work. Nobody has ever read a uuid to anybody.
--
-- Numbered per organisation and from one, because 1 is a reasonable first job
-- and 8f3a-… is not a number at all.

create table if not exists org_counters (
  organization_id uuid primary key references organizations(id) on delete cascade,
  next_job_number integer not null default 1
);

alter table org_counters enable row level security;

drop policy if exists "org_scoped_counters" on org_counters;
create policy "org_scoped_counters" on org_counters for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

alter table jobs add column if not exists job_number integer;

/*
 * Hands out the next number.
 *
 * The counter is bumped with a single UPDATE ... RETURNING, which takes a row
 * lock for the duration of the statement — two jobs created in the same
 * instant queue rather than both reading the same value and colliding. A
 * max(job_number)+1 would have that race, and a per-org sequence would need
 * one created for every organisation that ever signs up.
 */
create or replace function assign_job_number() returns trigger
language plpgsql
as $$
declare
  v_org uuid;
  v_number integer;
begin
  if new.job_number is not null then
    return new;
  end if;

  select c.organization_id into v_org
  from properties p
  join customers c on c.id = p.customer_id
  where p.id = new.property_id;

  if v_org is null then
    return new;
  end if;

  insert into org_counters (organization_id, next_job_number)
  values (v_org, 1)
  on conflict (organization_id) do nothing;

  update org_counters
  set next_job_number = next_job_number + 1
  where organization_id = v_org
  returning next_job_number - 1 into v_number;

  new.job_number := v_number;
  return new;
end;
$$;

drop trigger if exists set_job_number on jobs;
create trigger set_job_number before insert on jobs
  for each row execute function assign_job_number();

-- Existing jobs, oldest first, so the numbers read as the order work actually
-- came in rather than the order Postgres happened to return rows.
do $$
declare
  r record;
  v_org uuid;
  v_seq integer;
begin
  for v_org in
    select distinct c.organization_id
    from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
  loop
    v_seq := 1;
    for r in
      select j.id
      from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where c.organization_id = v_org and j.job_number is null
      order by j.created_at, j.id
    loop
      update jobs set job_number = v_seq where id = r.id;
      v_seq := v_seq + 1;
    end loop;

    insert into org_counters (organization_id, next_job_number)
    values (v_org, v_seq)
    on conflict (organization_id) do update set next_job_number = greatest(org_counters.next_job_number, v_seq);
  end loop;
end $$;

-- Unique within an organisation. Two businesses both having a job 1 is correct;
-- one business having two is a bug that would show up on a phone call.
create unique index if not exists jobs_org_number_idx
  on jobs(job_number, property_id)
  where job_number is not null;

-- ---------------------------------------------------------------- pipeline

-- What the CRM had them down as.
--
-- A pipeline stage describes a deal, not a person, so strictly this belongs on
-- a job. But an import arrives before anybody has decided which of three
-- thousand contacts deserve a job record, and dropping the column on the floor
-- loses the one field that says which of them were live. Parked on the contact,
-- visible, and convertible later.
alter table customers add column if not exists pipeline text;
alter table customers add column if not exists pipeline_stage text;
alter table customers add column if not exists opportunity_value numeric;

comment on column customers.pipeline_stage is
  'As the CRM had it, verbatim. Not mapped onto this app''s stages — a stage named in somebody else''s system means what they meant by it, and guessing is how a won deal becomes an open one.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0090_geocode_tracking.sql
-- ==========================================================
-- Remembering which addresses could not be placed.
--
-- Turning an imported address into a property means asking a geocoder where it
-- is. Most resolve. Some never will — a partial "Bel Air, MD", a typo, a rural
-- route with no number — and without a record of having tried, every run works
-- through the same failures again, spending the same lookups to get the same
-- nothing, and never reaching the addresses behind them.

alter table customers add column if not exists geocode_attempted_at timestamptz;
alter table customers add column if not exists geocode_error text;

-- The working set: imported addresses nobody has placed yet. Partial so it
-- stays small as the book grows past the ones still waiting.
create index if not exists customers_pending_geocode_idx
  on customers(organization_id)
  where import_address is not null and geocode_attempted_at is null;

comment on column customers.geocode_error is
  'Why the last attempt failed. Kept so a bad address can be corrected by hand rather than silently never appearing on a map.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0091_contact_merge_undo.sql
-- ==========================================================
-- Merging a contact deletes one. This is how to get it back.
--
-- A merge moves the duplicate's properties onto the keeper, fills the keeper's
-- blanks from it, and then deletes it. Every part of that is right, and the
-- last part is irreversible: the name, the tags, the CRM id, the pipeline
-- stage and the row's own identity are gone, and there is no record of which
-- properties moved or which blanks were filled.
--
-- That was tolerable while merges were occasional and hand-checked. It stops
-- being tolerable the moment a few thousand imported contacts arrive and the
-- duplicate list has hundreds of pairs on it — because then somebody is
-- merging quickly, and merging quickly means merging one wrong.
--
-- So every merge writes down enough to be undone: the whole deleted row, which
-- properties moved, and which fields were filled in on the keeper.

create table if not exists contact_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),

  -- The survivor. Not a foreign key: if it is later deleted the record of what
  -- happened should outlive it rather than vanish with it.
  kept_id uuid not null,
  kept_name text not null,

  -- The whole deleted row, as it was. A snapshot rather than columns, because
  -- a contact gains columns over time and an undo written against the shape of
  -- 2026 should still restore a row written today.
  merged_snapshot jsonb not null,
  merged_name text not null,

  -- Which properties changed hands, so an undo moves back exactly those and
  -- not any the keeper already had.
  moved_property_ids uuid[] not null default '{}',

  -- What the merge filled in on the keeper, so an undo can empty those again
  -- without touching anything somebody has typed since.
  patched_fields jsonb not null default '{}',

  merged_by uuid references profiles(id),
  merged_at timestamptz not null default now(),

  undone_at timestamptz,
  undone_by uuid references profiles(id)
);

create index if not exists contact_merges_recent_idx
  on contact_merges(organization_id, merged_at desc);

alter table contact_merges enable row level security;

drop policy if exists "org_scoped_contact_merges" on contact_merges;
create policy "org_scoped_contact_merges" on contact_merges for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

-- ==========================================================
-- 0092_target_markets.sql
-- ==========================================================
-- Where we actually work.
--
-- "Our market is Harford County" is a sentence everybody in the business
-- knows and nothing in the app did. So a bought list, a parcel import or a CRM
-- export lands with Baltimore, Cecil and half of Pennsylvania mixed in, and
-- the only way to tell is for somebody to recognise the town.
--
-- A table rather than a constant, because the answer changes. A business that
-- takes on a second crew takes on a second county, and the version where that
-- means a code change is the version where it never gets recorded.

create table if not exists target_markets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,

  -- Matched in this order: a zip is exact, a town is nearly exact, a county
  -- name only appears in some addresses. Any one matching is a match.
  zips text[] not null default '{}',
  cities text[] not null default '{}',
  counties text[] not null default '{}',

  active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, name)
);

create index if not exists target_markets_org_idx on target_markets(organization_id, active);

drop trigger if exists set_updated_at on target_markets;
create trigger set_updated_at before update on target_markets
  for each row execute function set_updated_at();

alter table target_markets enable row level security;

drop policy if exists "org_scoped_target_markets" on target_markets;
create policy "org_scoped_target_markets" on target_markets for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Everybody starts with the county they actually work in. Editable afterwards
-- — this is a starting point, not a decision made on their behalf.
insert into target_markets (organization_id, name, zips, cities, counties, notes)
select
  o.id,
  'Harford County, MD',
  array[
    '21001','21005','21009','21010','21013','21014','21015','21017','21018',
    '21028','21034','21040','21047','21050','21078','21082','21084','21085',
    '21130','21132','21154','21160','21161'
  ],
  array[
    'Aberdeen','Abingdon','Bel Air','Belcamp','Benson','Churchville','Darlington',
    'Edgewood','Fallston','Forest Hill','Havre de Grace','Jarrettsville','Joppa',
    'Perryman','Pylesville','Street','White Hall','Whiteford'
  ],
  array['Harford'],
  'Seeded with Harford County''s zips and towns. Edit or add markets as the business grows.'
from organizations o
on conflict (organization_id, name) do nothing;

-- Contacts get the same flag prospects already have, so an imported CRM export
-- can be sorted the same way a bought list is.
alter table customers add column if not exists in_target_market boolean;

comment on column customers.in_target_market is
  'Null until checked. False is not a reason to delete them — somebody outside our market still knows the neighbour inside it.';

notify pgrst, 'reload schema';


-- ==========================================================
-- 0093_knowledge_graph.sql
-- ==========================================================
-- A place to think, rather than another place to file things.
--
-- The point is not storing ideas. It is breaking them down far enough to see
-- what they physically come down to, because two ideas that look unrelated
-- usually are not: door hangers and flyers are the same paper, the same
-- printer, the same toner and the same designer, and nobody notices until
-- something draws the line.
--
-- So this is a graph, relationally — nodes and edges as rows, not one JSON
-- blob. A blob cannot answer "what else uses the printer", and that question
-- is the entire reason for the feature.

create table if not exists knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  title text not null,
  description text,

  -- Deliberately not all "idea". An idea that decomposes only into more ideas
  -- has not been decomposed; the value is in reaching the paper and the
  -- printer, which are things you can buy once and use eight times.
  node_type text not null default 'idea'
    check (node_type in (
      'idea','material','equipment','tool','machine','software','person','role',
      'skill','process','task','location','supplier','customer_type',
      'marketing_channel','distribution_method','cost','revenue_source',
      'product','service','principle','constraint','dependency','asset',
      'information','other'
    )),

  status text not null default 'idea'
    check (status in ('idea','researching','planned','active','completed','archived')),

  -- 1–5. Null until somebody cares enough to say.
  importance integer check (importance is null or (importance between 1 and 5)),
  estimated_cost numeric,
  potential_value numeric,

  notes text,

  -- Where the graph is drawn last time somebody moved it. Kept so a layout
  -- somebody arranged by hand survives a reload — an idea board that
  -- reshuffles itself every visit is one nobody builds a mental map of.
  position_x double precision,
  position_y double precision,

  -- Room for what has not been thought of yet, without a migration each time.
  metadata jsonb not null default '{}',

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_nodes_org_idx on knowledge_nodes(organization_id, node_type);
create index if not exists knowledge_nodes_org_status_idx on knowledge_nodes(organization_id, status);
-- Duplicate detection reads this on every keystroke of a quick-add.
create index if not exists knowledge_nodes_title_idx on knowledge_nodes(organization_id, lower(title));

drop trigger if exists set_updated_at on knowledge_nodes;
create trigger set_updated_at before update on knowledge_nodes
  for each row execute function set_updated_at();

create table if not exists knowledge_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  source_node_id uuid not null references knowledge_nodes(id) on delete cascade,
  target_node_id uuid not null references knowledge_nodes(id) on delete cascade,

  relationship_type text not null default 'related_to'
    check (relationship_type in (
      'uses','requires','produces','depends_on','similar_to','shares_resource_with',
      'can_be_combined_with','enables','replaces','leads_to','sold_through',
      'purchased_from','performed_by','used_by','located_at','requires_skill',
      'requires_equipment','requires_material','has_cost','generates_revenue',
      'part_of','parent_of','child_of','related_to'
    )),

  -- 1 is "these are vaguely connected", 5 is "without this the idea does not
  -- happen". Thickness on the graph, and eventually the difference between a
  -- nice-to-have and a bottleneck.
  strength integer not null default 3 check (strength between 1 and 5),
  notes text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  -- A node cannot use itself, and the same edge twice is one edge.
  constraint knowledge_relationships_not_self check (source_node_id <> target_node_id),
  unique (source_node_id, target_node_id, relationship_type)
);

-- Both directions indexed: "what does this use" and "what uses this" are
-- asked equally often, and the second is the one that finds the printer.
create index if not exists knowledge_rel_source_idx on knowledge_relationships(source_node_id);
create index if not exists knowledge_rel_target_idx on knowledge_relationships(target_node_id);
create index if not exists knowledge_rel_org_idx on knowledge_relationships(organization_id);

create table if not exists knowledge_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists knowledge_node_tags (
  node_id uuid not null references knowledge_nodes(id) on delete cascade,
  tag_id uuid not null references knowledge_tags(id) on delete cascade,
  primary key (node_id, tag_id)
);

create index if not exists knowledge_node_tags_tag_idx on knowledge_node_tags(tag_id);

alter table knowledge_nodes enable row level security;
alter table knowledge_relationships enable row level security;
alter table knowledge_tags enable row level security;
alter table knowledge_node_tags enable row level security;

-- Org-scoped like everything else. Who may open the tab at all is decided by
-- the app's permissions matrix, not here — this is the tenancy boundary.
drop policy if exists "org_scoped_knowledge_nodes" on knowledge_nodes;
create policy "org_scoped_knowledge_nodes" on knowledge_nodes for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "org_scoped_knowledge_relationships" on knowledge_relationships;
create policy "org_scoped_knowledge_relationships" on knowledge_relationships for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "org_scoped_knowledge_tags" on knowledge_tags;
create policy "org_scoped_knowledge_tags" on knowledge_tags for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "org_scoped_knowledge_node_tags" on knowledge_node_tags;
create policy "org_scoped_knowledge_node_tags" on knowledge_node_tags for all to authenticated
  using (
    exists (
      select 1 from knowledge_nodes n
      where n.id = knowledge_node_tags.node_id and n.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from knowledge_nodes n
      where n.id = knowledge_node_tags.node_id and n.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';

-- ==========================================================
-- 0094_knowledge_schedule.sql
-- ==========================================================
-- Ideas with a date on them.
--
-- A graph of things somebody might do is a graph nothing ever comes of. The
-- point of knowing that door hangers, flyers and postcards all run through
-- one printer is that the printer should then be busy — so an idea needs to
-- be able to say when it happens, and to say "and again next month" without
-- anybody re-entering it.
--
-- Kept as columns on the node rather than a schedule table, because an idea
-- has one schedule. A second table would let a node have two, and the first
-- question anybody asks is "when is this next", which a column answers and a
-- join makes into a decision about which row wins.

alter table knowledge_nodes add column if not exists scheduled_for date;

alter table knowledge_nodes add column if not exists recurrence text not null default 'none';
alter table knowledge_nodes drop constraint if exists knowledge_nodes_recurrence_check;
alter table knowledge_nodes add constraint knowledge_nodes_recurrence_check
  check (recurrence in ('none','daily','weekly','fortnightly','monthly','quarterly','yearly'));

-- "Every 2 months" is the same recurrence with a different step. Capped so a
-- typo cannot schedule something four hundred years out.
alter table knowledge_nodes add column if not exists recurrence_interval integer not null default 1;
alter table knowledge_nodes drop constraint if exists knowledge_nodes_recurrence_interval_check;
alter table knowledge_nodes add constraint knowledge_nodes_recurrence_interval_check
  check (recurrence_interval between 1 and 52);

-- When it last actually happened, and how many times. Cheap history: the
-- count is what tells you the printer earned its money.
alter table knowledge_nodes add column if not exists last_done_at date;
alter table knowledge_nodes add column if not exists times_done integer not null default 0;

comment on column knowledge_nodes.scheduled_for is
  'The next date this should happen. Null means it is still only an idea, which is a fine thing for an idea to be.';

-- What is due is read far more often than anything else about a node.
create index if not exists knowledge_nodes_due_idx
  on knowledge_nodes(organization_id, scheduled_for)
  where scheduled_for is not null;

notify pgrst, 'reload schema';

-- ==========================================================
-- 0095_knowledge_costs.sql
-- ==========================================================
-- What an idea actually costs.
--
-- Breaking "door hangers" down into cardstock, toner and design time is only
-- half an answer. The other half is that it is 2,000 sheets, one toner
-- cartridge and four hours, and that those numbers are what turn a good idea
-- into one somebody can decide about.
--
-- Two pieces, in two places, because they belong to different things. What a
-- sheet of cardstock costs belongs to the cardstock — it is the same price
-- whoever is buying it. How many sheets belongs to the connection, because
-- door hangers need two thousand and postcards need five hundred.

-- Cost per unit lives on the node. estimated_cost already existed and was
-- never surfaced anywhere, so it becomes the per-unit price rather than
-- shipping a second cost column nobody could tell apart from the first.
comment on column knowledge_nodes.estimated_cost is
  'Cost of one unit — one sheet, one hour, one bag. Multiplied by the quantity on each connection.';

alter table knowledge_nodes add column if not exists unit text not null default 'each';
alter table knowledge_nodes drop constraint if exists knowledge_nodes_unit_check;
alter table knowledge_nodes add constraint knowledge_nodes_unit_check
  check (unit in (
    'each','hour','day','week','month','sheet','box','pack','bag','roll',
    'gallon','pound','ton','ft','sq ft','yard','mile','job','visit'
  ));

comment on column knowledge_nodes.unit is
  'What one of it is. An hour or a day makes this time rather than materials, which is how the two totals stay apart.';

-- How much of it this particular idea needs.
alter table knowledge_relationships add column if not exists quantity numeric;
alter table knowledge_relationships drop constraint if exists knowledge_relationships_quantity_check;
alter table knowledge_relationships add constraint knowledge_relationships_quantity_check
  check (quantity is null or quantity >= 0);

comment on column knowledge_relationships.quantity is
  'How many units of the target this connection needs. Null means nobody has said yet, which costs nothing rather than guessing.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0096_knowledge_inventory_link.sql
-- ==========================================================
-- Ideas that point at real things you can actually buy.
--
-- The graph knowing "cardstock, twelve cents a sheet" is useful right up
-- until somebody has to order it, at which point the useful thing is the
-- material in the inventory: what it costs today, how many are left, where
-- it is stored and the link to the page you buy it from.
--
-- So a node can be linked to a material rather than describing one. Linked,
-- the material is the price — one number, in the place the rest of the
-- business already keeps it, instead of a second copy in the graph that
-- drifts the first time somebody's supplier puts prices up.

-- Marketing stock is inventory, but it is not job inventory. Door hangers
-- have no business appearing in the material list an estimator picks from
-- while pricing a patio, so it is a category rather than a separate table:
-- the ordering, stock levels, storage and reorder alerts are all the same
-- problem and deserve the same screen.
alter table materials add column if not exists category text not null default 'job';
alter table materials drop constraint if exists materials_category_check;
alter table materials add constraint materials_category_check
  check (category in ('job','marketing'));

comment on column materials.category is
  'job = used on site and quotable. marketing = door hangers, flyers, signs. Same inventory, different list.';

create index if not exists materials_category_idx on materials(organization_id, category, active);

-- Where you buy it, for something the graph is tracking on its own.
alter table knowledge_nodes add column if not exists purchase_url text;

-- Or, better, the real material — in which case the material is the price.
alter table knowledge_nodes add column if not exists material_id uuid references materials(id) on delete set null;

comment on column knowledge_nodes.material_id is
  'Linked inventory material. When set, its cost and purchase link win over the ones on the node — one price, in one place.';

create index if not exists knowledge_nodes_material_idx on knowledge_nodes(material_id)
  where material_id is not null;

notify pgrst, 'reload schema';

-- ==========================================================
-- 0097_costs_from_inventory.sql
-- ==========================================================
-- One price, and it lives in inventory.
--
-- knowledge_nodes.estimated_cost was the graph's own copy of what something
-- cost. It is no longer written or read: a number typed into an idea board
-- outlives whatever it was guessing about, and two prices for one material is
-- worse than one price and an honest gap.
--
-- Kept rather than dropped, because dropping a column is the one migration
-- that cannot be undone by running the next one.

comment on column knowledge_nodes.estimated_cost is
  'Unused. Cost comes from the linked material in inventory — see material_id. Left in place rather than dropped.';

comment on column knowledge_nodes.unit is
  'What one of it is, for reading quantities and for telling time from materials. The price is the material''s, not this.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0098_knowledge_tool_link.sql
-- ==========================================================
-- The rest of the inventory.
--
-- A node could be linked to a material and nothing else, which quietly meant
-- half the inventory did not exist as far as the graph was concerned. The
-- printer an idea runs through is a tool. So are the mower, the blower and
-- the crew's gear, and an idea that needs one of them needs it whichever
-- table it happens to live in.

alter table knowledge_nodes add column if not exists tool_id uuid references tools(id) on delete set null;

comment on column knowledge_nodes.tool_id is
  'Linked inventory tool or crew gear. Like material_id, its cost and purchase link win over anything on the node.';

create index if not exists knowledge_nodes_tool_idx on knowledge_nodes(tool_id)
  where tool_id is not null;

-- One or the other, never both: two prices for one node is the thing all of
-- this exists to stop.
alter table knowledge_nodes drop constraint if exists knowledge_nodes_one_inventory_link;
alter table knowledge_nodes add constraint knowledge_nodes_one_inventory_link
  check (material_id is null or tool_id is null);

notify pgrst, 'reload schema';

-- ==========================================================
-- 0099_cost_basis.sql
-- ==========================================================
-- Bought again, or bought once.
--
-- The graph has been guessing this from the kind of thing something is:
-- a tool is kit, a material is used up. That is right most of the time and
-- wrong in the cases that cost money. A pallet of cardstock is a material and
-- gets used up. A sign frame is a material in inventory and gets put back in
-- the truck at the end of the day — charging it to every run overstates every
-- campaign that uses it, which is the double charge this exists to stop.
--
-- So it becomes something somebody says out loud when they add it, rather than
-- something the app infers from a dropdown they were not thinking about.

alter table knowledge_nodes add column if not exists cost_basis text;
alter table knowledge_nodes drop constraint if exists knowledge_nodes_cost_basis_check;
alter table knowledge_nodes add constraint knowledge_nodes_cost_basis_check
  check (cost_basis is null or cost_basis in ('consumable', 'capital'));

comment on column knowledge_nodes.cost_basis is
  'consumable = bought again every run. capital = bought once and kept, charged once however many things use it. Null falls back to what the node type implies.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0100_units_outputs_and_fees.sql
-- ==========================================================
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

-- ==========================================================
-- 0101_inventory_kind_resale_steps.sql
-- ==========================================================
-- Three small columns, three things they make possible.
--
-- What an inventory item actually is, said the same way on every tab. What we
-- would get back for it if we ever sold it. And what order the steps go in.

-- ============================================================
-- Tool, material, or other
-- ============================================================
-- Tools live in their own table already. This is for the third answer: a
-- thing that is neither, and is only ever a cost — a permit, a subcontractor,
-- a delivery fee. It sits with the materials because it is bought and
-- reordered like one; it is flagged because it is not used up like one and
-- has nothing to sell on.
alter table materials add column if not exists kind text not null default 'material';
alter table materials drop constraint if exists materials_kind_check;
alter table materials add constraint materials_kind_check
  check (kind in ('material', 'other'));

comment on column materials.kind is
  'material = stock that gets used up. other = a cost with nothing behind it: a fee, a permit, somebody else''s invoice.';

-- ============================================================
-- What we would get back for it
-- ============================================================
-- A rough ten per cent of what it cost, which is a starting point rather than
-- a valuation — enough to know whether selling the old mower is worth the
-- afternoon it would take. Stored only where somebody disagrees with the
-- default, so changing the rule later does not leave a thousand stale numbers
-- behind it.
alter table materials add column if not exists resale_value numeric
  check (resale_value is null or resale_value >= 0);
alter table tools add column if not exists resale_value numeric
  check (resale_value is null or resale_value >= 0);

comment on column materials.resale_value is
  'What we would get back, where somebody has said. Null means use the default rule. Never applies to kind = other — there is nothing to sell.';
comment on column tools.resale_value is
  'What we would get back, where somebody has said. Null means use the default rule. Never applies to a rental — we do not own it.';

-- ============================================================
-- The order things happen in
-- ============================================================
-- A breakdown says what an idea is made of. It does not say what happens
-- first, and for anything somebody has to actually carry out, that is the
-- part they need.
alter table knowledge_relationships add column if not exists step_order integer
  check (step_order is null or step_order > 0);

comment on column knowledge_relationships.step_order is
  'Where this comes in the sequence, counting from 1. Null means it is part of the thing rather than a step in it.';

create index if not exists knowledge_rel_steps_idx
  on knowledge_relationships(source_node_id, step_order)
  where step_order is not null;

notify pgrst, 'reload schema';
