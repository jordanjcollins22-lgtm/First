-- How many of a tool belong in a kit, as opposed to how many we own.
--
-- The two were the same number and they are not the same fact. We own three
-- flat shovels; the kit takes one. The checklist was printing "× 3" beside a
-- kit that contains one of them, so somebody counting the van against the
-- sheet would find two missing that were never there.
--
-- One of each is the normal case, so this holds only the exceptions: a kit
-- with no entry here takes one. Storing every tool's every kit at one would be
-- a row of ones to maintain and a row of ones to get wrong.
--
-- Keyed by kit number, which is what `kits` already holds — a kit is however
-- many tools claim to be in it, and there is no kit table to point at.
alter table tools
  add column if not exists kit_quantities jsonb not null default '{}'::jsonb;

comment on column tools.kit_quantities is
  'How many of this tool belong in each kit, keyed by kit number, e.g. {"1": 2}. Absent means one, which is the normal case. Distinct from quantity, which is how many we own in total.';

notify pgrst, 'reload schema';
