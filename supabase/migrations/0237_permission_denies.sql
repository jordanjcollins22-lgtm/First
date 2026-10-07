-- Granting a page to somebody must never take it away from an admin.
--
-- The matrix stored grants only, and an admin was allowed a page if it was
-- ticked for them OR if nobody anywhere had ticked it for any role. That
-- second clause is the trap: the moment somebody ticked a page for the crew,
-- it became "configured", and an admin who had never ticked their own box
-- silently lost it. Enabling permissions for other people took pages off the
-- owner's own menu, which is exactly what happened here.
--
-- The fix is to say no out loud. A row can now be a denial rather than only a
-- grant, which separates "an admin deliberately unticked this for themselves"
-- from "nobody has thought about this yet" -- two states that were
-- indistinguishable and had to mean the same thing.
--
-- Everything already in the table is a grant, which is what the default says.
alter table role_permissions add column if not exists granted boolean not null default true;

comment on column role_permissions.granted is
  'True grants the page to the role. False denies it, which only matters for admin: every other role is denied by having no row at all. The distinction stops granting a page to one role from stripping it from another.';

notify pgrst, 'reload schema';
