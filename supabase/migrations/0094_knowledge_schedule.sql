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
