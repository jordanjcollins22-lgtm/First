-- One record per person, from first application to advancement or offboarding.
--
-- Additive. It adds two application stages and one column to job_applicants,
-- and otherwise only new tables. Team accounts and applicants already in the
-- system each get one person record, matched by email so nobody is doubled.
-- The pages read through the service role after checking the People tab.

alter table public.job_applicants drop constraint if exists job_applicants_stage_check;
alter table public.job_applicants add constraint job_applicants_stage_check check (
  stage in ('screened_out', 'needs_review', 'video_requested', 'video_submitted', 'interview', 'offer', 'hired', 'not_a_fit', 'withdrawn')
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  position text,
  stage text not null default 'application' check (stage in (
    'application', 'screening', 'interview', 'job_offer', 'onboarding', 'training',
    'evaluation', 'deployment', 'performance_management', 'advancement', 'offboarding'
  )),
  -- active: moving. declined and withdrawn end before hire. offboarded ends after it.
  status text not null default 'active' check (status in ('active', 'declined', 'withdrawn', 'offboarded')),
  classification text not null default 'undetermined' check (classification in ('undetermined', 'employee', 'contractor')),
  owner_id uuid references public.profiles(id) on delete set null,
  stage_entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists people_one_per_email on public.people (organization_id, lower(email)) where email is not null;
create index if not exists people_org_stage on public.people (organization_id, status, stage);

alter table public.job_applicants add column if not exists person_id uuid references public.people(id) on delete set null;
create index if not exists job_applicants_person on public.job_applicants (person_id);

-- Everything that happened to a person. Append-only.
create table if not exists public.person_events (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  detail jsonb,
  actor uuid references public.profiles(id) on delete set null,
  actor_name text
);
create index if not exists person_events_person on public.person_events (person_id, at desc);

-- The editable checklists, one row per item.
create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage text not null,
  item_key text not null,
  part text check (part in ('compliance', 'clarity', 'culture', 'connection', 'check_back')),
  label text not null,
  required boolean not null default true,
  legal boolean not null default false,
  -- Empty applies to everyone.
  positions text[] not null default '{}',
  -- any, employee or contractor.
  applies_to text not null default 'any' check (applies_to in ('any', 'employee', 'contractor')),
  due_days integer,
  due_business_days integer,
  sort integer not null default 0,
  active boolean not null default true,
  unique (organization_id, stage, item_key)
);

-- One person's copy, made when they enter the stage, so later edits never rewrite a record.
create table if not exists public.person_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  stage text not null,
  item_key text not null,
  part text,
  label text not null,
  required boolean not null default true,
  legal boolean not null default false,
  due_on date,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  done_by_name text,
  document_path text,
  note text,
  sort integer not null default 0,
  unique (person_id, stage, item_key)
);
create index if not exists person_items_open on public.person_items (organization_id, done_at, due_on);

create table if not exists public.interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  applicant_id uuid references public.job_applicants(id) on delete set null,
  interviewer_id uuid references public.profiles(id) on delete set null,
  interviewer_name text,
  -- { criterion: { score: 1-5, note: text } }
  scores jsonb not null default '{}'::jsonb,
  notes text,
  outcome text not null check (outcome in ('advance', 'additional_interview', 'decline')),
  created_at timestamptz not null default now()
);
create index if not exists interview_scorecards_person on public.interview_scorecards (person_id, created_at desc);

create table if not exists public.job_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  applicant_id uuid references public.job_applicants(id) on delete set null,
  position text not null,
  compensation text not null,
  classification text not null check (classification in ('employee', 'contractor')),
  schedule text not null,
  responsibilities text not null,
  transportation text not null,
  start_date date not null,
  agreements text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'withdrawn')),
  sent_at timestamptz,
  responded_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_offers_person on public.job_offers (person_id, created_at desc);

create table if not exists public.training_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null,
  title text not null,
  purpose text not null,
  materials text[] not null default '{}',
  safety text[] not null default '{}',
  steps text[] not null default '{}',
  standards text[] not null default '{}',
  mistakes text[] not null default '{}',
  demo_url text,
  practice text not null default '',
  criteria text[] not null default '{}',
  competency_key text not null,
  competency_label text not null,
  positions text[] not null default '{}',
  required boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (organization_id, module_key)
);

create table if not exists public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  module_id uuid not null references public.training_modules(id) on delete cascade,
  read_at timestamptz,
  shown_at timestamptz,
  showed_back_at timestamptz,
  taught_at timestamptz,
  trainer_name text,
  note text,
  assigned_at timestamptz not null default now(),
  unique (person_id, module_id)
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  module_id uuid references public.training_modules(id) on delete set null,
  subject text not null,
  evaluator_id uuid references public.profiles(id) on delete set null,
  evaluator_name text,
  evaluated_on date not null default current_date,
  -- [{ criterion, met }]
  results jsonb not null default '[]'::jsonb,
  notes text,
  document_paths text[] not null default '{}',
  corrective_actions text,
  outcome text not null check (outcome in ('pass', 'needs_improvement', 'fail')),
  created_at timestamptz not null default now()
);
create index if not exists evaluations_person on public.evaluations (person_id, created_at desc);

create table if not exists public.person_competencies (
  person_id uuid not null references public.people(id) on delete cascade,
  competency_key text not null,
  label text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evaluation_id uuid references public.evaluations(id) on delete set null,
  verified_by_name text,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (person_id, competency_key)
);

create table if not exists public.performance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('quality', 'completion', 'productivity', 'attendance', 'safety', 'communication', 'customer', 'callback', 'procedures', 'feedback', 'retraining', 'review')),
  result text not null check (result in ('good', 'needs_work', 'note')),
  note text not null,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists performance_records_person on public.performance_records (person_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['people','person_events','checklist_templates','person_items','interview_scorecards','job_offers','training_modules','training_assignments','evaluations','person_competencies','performance_records']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select is_admin()))', t || '_admin_read', t);
  end loop;
end $$;

-- Files for checklists and evaluations. Private: reached through signed links only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('people-docs', 'people-docs', false, 209715200)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Uploads and viewing use signed links from the server. These say which admins may reach the files directly.
drop policy if exists people_docs_admin_read on storage.objects;
create policy people_docs_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'people-docs' and (select is_admin()));
drop policy if exists people_docs_admin_write on storage.objects;
create policy people_docs_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'people-docs' and (select is_admin()));

-- Everyone on the team now, by email, already working.
insert into public.people (organization_id, profile_id, full_name, email, phone, stage, status)
select p.organization_id, p.id, coalesce(nullif(trim(p.full_name), ''), p.email), lower(p.email), p.phone,
  case when p.trial_crew then 'training' else 'performance_management' end, 'active'
from public.profiles p
where p.organization_id is not null and p.email is not null
on conflict do nothing;

-- Applicants, newest application first so its details win, joined to the team record when the email matches.
insert into public.people (organization_id, full_name, email, phone, position, stage, status, stage_entered_at, created_at)
select distinct on (a.organization_id, lower(a.email))
  a.organization_id, a.name, lower(a.email), a.phone, a.position,
  case a.stage
    when 'screened_out' then 'screening' when 'needs_review' then 'screening'
    when 'video_requested' then 'screening' when 'video_submitted' then 'screening'
    when 'interview' then 'interview' when 'offer' then 'job_offer'
    when 'hired' then 'onboarding' when 'not_a_fit' then 'interview'
    when 'withdrawn' then 'screening'
  end,
  case a.stage when 'screened_out' then 'declined' when 'not_a_fit' then 'declined' when 'withdrawn' then 'withdrawn' else 'active' end,
  a.updated_at, a.created_at
from public.job_applicants a
order by a.organization_id, lower(a.email), a.created_at desc
on conflict do nothing;

update public.job_applicants a set person_id = p.id
from public.people p
where a.person_id is null and p.organization_id = a.organization_id and lower(p.email) = lower(a.email);

insert into public.person_events (person_id, kind, detail)
select id, 'record_created', jsonb_build_object('from', 'existing records') from public.people;

notify pgrst, 'reload schema';
