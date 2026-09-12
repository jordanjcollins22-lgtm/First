-- Crew gear — PPE (gloves, safety masks), site protection (tarps, plywood),
-- and crew supplies (water, electrolyte powder) — is tracked the same way a
-- tool is: quantity on hand, where it's stored, reorder point, cost. So it
-- lives in the tools table under a category rather than in a parallel table,
-- which also makes moving something that's already been entered as a tool a
-- one-field change instead of a re-entry.
alter table tools add column if not exists category text not null default 'tool';
alter table tools drop constraint if exists tools_category_check;
alter table tools add constraint tools_category_check check (category in ('tool', 'gear'));

create index if not exists tools_category_idx on tools(category);

notify pgrst, 'reload schema';
