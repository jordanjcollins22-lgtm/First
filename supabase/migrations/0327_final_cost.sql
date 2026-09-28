-- What the job really cost, entered by the account manager at the final
-- sign-off: the project review is scored on these from then on.
alter table public.jobs add column if not exists final_crew_hours numeric;
alter table public.jobs add column if not exists final_materials_cents integer;
alter table public.jobs add column if not exists final_other_cents integer;
alter table public.jobs add column if not exists final_cost_note text;
