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
