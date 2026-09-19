-- Notes pinned to a place on the evaluation picture.
--
-- The evaluation records what the work is and where the zones are. It had
-- nowhere to put the things that are neither — the broken sprinkler head, the
-- gate that has to stay shut, the bank too steep to mow. Those went in
-- somebody's memory and arrived on site as a surprise.
--
-- Same shape as zones and the property line: a jsonb array on the design,
-- because a mark has no life of its own away from the picture it is on.

alter table canvas_designs add column if not exists marks jsonb not null default '[]';

comment on column canvas_designs.marks is
  'Notes pinned to points on the picture: [{id, x, y, note, authorName, createdAt}]. Numbered in the order they were placed, and shown in that order everywhere.';

notify pgrst, 'reload schema';
