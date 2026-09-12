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
