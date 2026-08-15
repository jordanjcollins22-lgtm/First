-- A free-text description per material, distinct from its short name --
-- filled in manually or autofilled from the purchase link when possible.

alter table materials add column if not exists description text;
