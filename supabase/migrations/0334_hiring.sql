-- Hiring: people who apply from an Indeed ad, through the questions, the
-- video, and the in-person interview.
--
-- An applicant has no account. They apply on a public page, and the token in
-- their video link is the whole of their access, like a pre-evaluation form.
-- So the public side writes only through the service role, and the people
-- reviewing read and decide as admins.

create table if not exists public.job_applicants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  position text not null check (position in ('account-manager', 'evaluator', 'affiliate', 'project-technician', 'project-lead')),
  -- Opens their video page. 24 hex characters, like a pre-evaluation link.
  token text not null unique check (token ~ '^[0-9a-f]{24}$'),
  name text not null,
  email text not null,
  phone text not null,
  zip text not null,
  -- Their answers, keyed by question, as the form asked them.
  answers jsonb not null default '{}'::jsonb,
  -- Each knockout question they did not pass, in our words. Empty when they passed.
  screen_reasons text[] not null default '{}',
  stage text not null check (stage in ('screened_out', 'video_requested', 'video_submitted', 'interview', 'hired', 'not_a_fit', 'withdrawn')),
  -- Where they came from: ?src= on the apply link, so Indeed can be told from Facebook.
  source text,
  -- The video, uploaded (a path in applicant-videos) or as a link when it was too big to upload.
  video_path text,
  video_link text,
  video_submitted_at timestamptz,
  -- The review.
  rating smallint check (rating between 1 and 5),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  interview_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_applicants_org_stage on public.job_applicants (organization_id, stage, created_at desc);
create index if not exists job_applicants_email on public.job_applicants (organization_id, lower(email));

alter table public.job_applicants enable row level security;
drop policy if exists job_applicants_admin_read on public.job_applicants;
create policy job_applicants_admin_read on public.job_applicants for select to authenticated
  using ((select is_admin()));
drop policy if exists job_applicants_admin_update on public.job_applicants;
create policy job_applicants_admin_update on public.job_applicants for update to authenticated
  using ((select is_admin())) with check ((select is_admin()));
-- No insert or delete policy: applications come in through the service role,
-- and an application is never deleted, only decided.

-- Everything that happened to an application, in order: applied, screened,
-- video in, rated, invited, decided. Append-only, like the role edit log.
create table if not exists public.applicant_events (
  id bigint generated always as identity primary key,
  applicant_id uuid not null references public.job_applicants(id) on delete cascade,
  at timestamptz not null default now(),
  -- applied, video_submitted, reviewed, stage_changed, email_sent
  kind text not null,
  detail jsonb,
  -- Null when the applicant did it themselves.
  actor uuid references public.profiles(id),
  actor_name text
);

create index if not exists applicant_events_applicant on public.applicant_events (applicant_id, at);

alter table public.applicant_events enable row level security;
drop policy if exists applicant_events_admin_read on public.applicant_events;
create policy applicant_events_admin_read on public.applicant_events for select to authenticated
  using ((select is_admin()));
-- No insert, update or delete policies: the server writes as the service
-- role, and nothing rewrites history.

-- The videos. Private: only the reviewers see them, through a signed link.
-- 200 MB covers a minute or two from a phone; anything bigger is sent as a link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'applicant-videos',
  'applicant-videos',
  false,
  209715200,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Applicants upload through a signed upload link the server makes, and the
-- reviewer watches through a signed link, so neither needs a policy. These
-- let an admin reach the files directly too, and say who may, so the bucket
-- is never one nothing can read or write.
drop policy if exists applicant_videos_admin_read on storage.objects;
create policy applicant_videos_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'applicant-videos' and (select is_admin()));
drop policy if exists applicant_videos_admin_write on storage.objects;
create policy applicant_videos_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'applicant-videos' and (select is_admin()));
