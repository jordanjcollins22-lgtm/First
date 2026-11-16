-- A new hire's way from day one to fully operating (hiring structure steps
-- 13 to 21, and Alex Hormozi's three levels). Each check-in held, review
-- done and training sign-off is one row, so who did it and when is kept.

alter table public.onboarding_checklists add column if not exists buddy_name text;
alter table public.onboarding_checklists add column if not exists owns_checklists boolean not null default false;

create table if not exists public.new_hire_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checklist_id uuid not null references public.onboarding_checklists(id) on delete cascade,
  -- checkin: key is the date and slot (2026-11-17-am). review: 30, 60 or 90.
  -- training: task:phase. plan and culture: the day they went through it.
  kind text not null check (kind in ('checkin', 'review', 'training', 'plan', 'culture', 'connect', 'taper')),
  key text not null,
  done_at timestamptz not null default now(),
  done_by uuid references public.profiles(id) on delete set null,
  done_by_name text,
  note text,
  unique (checklist_id, kind, key)
);
create index if not exists new_hire_steps_checklist on public.new_hire_steps (checklist_id, kind);
create index if not exists new_hire_steps_trainer on public.new_hire_steps (organization_id, done_by) where kind = 'training';
alter table public.new_hire_steps enable row level security;
drop policy if exists new_hire_steps_admin on public.new_hire_steps;
create policy new_hire_steps_admin on public.new_hire_steps
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));
