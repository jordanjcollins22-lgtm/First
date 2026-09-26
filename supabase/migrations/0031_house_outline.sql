-- The marked house pin was never persisted, only property_line was — so
-- every job's site map reset back to "Mark the house" on every page load
-- no matter how far along it actually was.
alter table canvas_designs add column if not exists house_outline jsonb not null default '[]';
