-- A node can open the screen it is about.
--
-- The graph already knows a flyer needs paper, toner and a designer. It did
-- not know that the flyer itself is built on a page in this app, so somebody
-- reading the node had to go and find it. That is the same gap the inventory
-- link closed for materials: the node described a thing instead of pointing
-- at it.

alter table knowledge_nodes add column if not exists app_route text;

comment on column knowledge_nodes.app_route is
  'A screen in this app that this node opens. Chosen from a fixed list in src/lib/knowledge-links.ts, never typed — a route that rots is worse than no link.';

-- ============================================================
-- Link up what is already there
-- ============================================================
-- Only where nobody has said otherwise, and only on the ways-of-reaching-
-- people nodes, so a material called "flyer paper" is left alone.
update knowledge_nodes
set app_route = '/admin/flyer'
where app_route is null
  and node_type in ('marketing_channel', 'distribution_method', 'idea', 'process', 'product')
  and (title ilike '%flyer%' or title ilike '%flier%' or title ilike '%eddm%');

-- ============================================================
-- Social media, if it isn't on the board yet
-- ============================================================
-- The before-and-afters come off jobs we have already done, which makes
-- social media the cheapest channel we have — it costs a photograph somebody
-- already took. A channel that earns like that belongs on the board where it
-- can be crossed with everything else.
insert into knowledge_nodes (organization_id, title, description, node_type, status, importance, app_route, notes)
select
  o.id,
  'Social media',
  'Before-and-after posts made from the photos crews already take on every job.',
  'marketing_channel',
  'active',
  4,
  '/admin/social',
  'Costs nothing but the approval: the photographs are taken anyway because a job cannot be signed off without them.'
from organizations o
where not exists (
  select 1 from knowledge_nodes n
  where n.organization_id = o.id
    and (n.app_route = '/admin/social' or lower(n.title) in ('social media', 'social'))
);

notify pgrst, 'reload schema';
