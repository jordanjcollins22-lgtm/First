-- Adds a third role, "evaluator" — someone who creates property estimates
-- but isn't an admin (can't manage inventory/pricing/team) and isn't field
-- crew either. Same "label only, no hard restrictions yet" scope as the
-- rest of the roles work so far.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'crew', 'evaluator'));
