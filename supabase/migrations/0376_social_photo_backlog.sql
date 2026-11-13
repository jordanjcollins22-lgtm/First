-- Photo backlog: photos uploaded on Admin › Social to be turned into posts.
--
-- Each photo uploaded to the backlog becomes a social_posts draft straight
-- away (caption, accounts, suggested time), waiting for Approve or Deny.
-- Crew photos from finished jobs become drafts the same way, without a row
-- here. Nothing is posted until somebody approves it.
--
-- 1. social_photo_backlog: one row per uploaded photo. The file is in the
--    private job-photos bucket under backlog/<organization id>/, put there
--    through a signed upload URL the server hands out, so no new storage
--    policy is needed. Optional town, service and note feed the caption.
-- 2. social_posts.backlog_photo_id: which backlog photo a draft was made
--    from (the queue labels it "Uploaded"), one draft per photo.
-- 3. One crew-photo draft per job: the automatic drafts (auto_source
--    'crew_photos', from the crew's actions, the posting cron's catch-up
--    and the marketing autopilot) never stack up for the same job.
--
-- Safe to run twice.

-- 1. The backlog -----------------------------------------------------------

create table if not exists public.social_photo_backlog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- In the job-photos bucket: backlog/<organization id>/<file>.
  path text not null,
  town text,
  service text,
  note text,
  social_post_id uuid references public.social_posts(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_photo_backlog_path_check check (path like 'backlog/%')
);

create index if not exists social_photo_backlog_org_idx
  on public.social_photo_backlog (organization_id, created_at desc);

alter table public.social_photo_backlog enable row level security;

drop policy if exists social_photo_backlog_own_org on public.social_photo_backlog;
create policy social_photo_backlog_own_org on public.social_photo_backlog
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- 2. Which backlog photo a draft came from -----------------------------------

alter table public.social_posts add column if not exists backlog_photo_id uuid
  references public.social_photo_backlog(id) on delete set null;

create unique index if not exists social_posts_backlog_photo_idx
  on public.social_posts (backlog_photo_id) where backlog_photo_id is not null;

-- 3. One automatic crew-photo draft per job ----------------------------------

-- auto_source arrived with 0362; repeated here so this runs on its own.
alter table public.social_posts add column if not exists auto_source text;

do $$
begin
  if exists (
    select 1 from public.social_posts
     where auto_source = 'crew_photos' and job_id is not null
     group by job_id having count(*) > 1
  ) then
    raise notice 'Some jobs already have more than one crew-photo post; the one-per-job index is skipped (the app still checks).';
  else
    create unique index if not exists social_posts_crew_job_idx
      on public.social_posts (job_id) where auto_source = 'crew_photos' and job_id is not null;
  end if;
end $$;

notify pgrst, 'reload schema';
