-- Materials: whether it can be stored on-site, where to go instead if not,
-- what's needed to store it, and what storing it costs.
alter table materials add column if not exists can_store boolean not null default true;
alter table materials add column if not exists storage_alternative text;
alter table materials add column if not exists storage_requirements text;
alter table materials add column if not exists storage_cost numeric;

-- Tools: why a rented tool isn't owned, and what owning it would cost.
alter table tools add column if not exists not_owned_reason text;
alter table tools add column if not exists cost_to_own numeric;
