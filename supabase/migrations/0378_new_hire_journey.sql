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
  -- The recorded call, a path in call-recordings. Check-ins and reviews are
  -- logged only with one.
  recording_path text,
  unique (checklist_id, kind, key)
);
alter table public.new_hire_steps add column if not exists recording_path text;
create index if not exists new_hire_steps_checklist on public.new_hire_steps (checklist_id, kind);
create index if not exists new_hire_steps_trainer on public.new_hire_steps (organization_id, done_by) where kind = 'training';
alter table public.new_hire_steps enable row level security;
drop policy if exists new_hire_steps_admin on public.new_hire_steps;
create policy new_hire_steps_admin on public.new_hire_steps
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_admin()))
  with check (organization_id = (select current_org_id()) and (select is_admin()));

-- Recorded hiring calls: interviews, check-ins and reviews, audio only.
-- Private: the app records through a signed upload link it makes and plays
-- back through a signed link. Everyone on a call is told first (Maryland is
-- an all-party consent state).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  52428800,
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'video/webm', 'video/mp4']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists call_recordings_admin_read on storage.objects;
create policy call_recordings_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'call-recordings' and (select is_admin()));
drop policy if exists call_recordings_admin_write on storage.objects;
create policy call_recordings_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'call-recordings' and (select is_admin()));
