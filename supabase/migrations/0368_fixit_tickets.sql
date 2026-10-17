-- Fix-it tickets: the owner's bug reports, typed into Discord.
--
-- `/fixit` in the owner's Discord channel saves a ticket (what's wrong and a
-- screenshot), `/build` queues one build of every open ticket, and a separate
-- job picks the build up, makes the fixes on a branch and sets it "ready"
-- with a summary, a preview link and each ticket's result. The app posts
-- that summary back to the channel; `/approve` puts it live and `/sendback`
-- reopens one ticket with a note.
--
-- Every write is the server with the service role (the Discord route, the
-- notify cron, the owner's own buttons after checking who they are). A
-- signed-in admin may read their own business's rows, nothing more.
--
-- No `drop ... if exists` here: those emit NOTICEs that hang the SQL runner.
-- Everything is `if not exists`, `or replace`, or a guarded DO block.

-- ---------------------------------------------------------------------------
-- Builds: one run of the fixing job over every open ticket.
-- ---------------------------------------------------------------------------
create table if not exists public.fixit_builds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Per business, 1, 2, 3 …: set by the trigger below when left out.
  number int not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'approved', 'failed')),
  -- The Discord user (or app person) who asked for it, as text.
  requested_by text,
  branch text,
  preview_url text,
  summary text,
  -- When the summary was posted to Discord; null until then.
  notified_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);

-- Only one build in the works at a time per business.
create unique index if not exists fixit_builds_one_active
  on public.fixit_builds (organization_id) where status in ('queued', 'running');
-- What the notify cron looks for.
create index if not exists fixit_builds_to_notify
  on public.fixit_builds (status) where notified_at is null and status in ('ready', 'failed');

-- ---------------------------------------------------------------------------
-- Tickets: one thing to fix.
-- ---------------------------------------------------------------------------
create table if not exists public.fixit_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number int not null,
  description text not null,
  -- Path in the private fixit-screenshots bucket, "<org id>/<file>".
  screenshot_path text,
  -- A long-lived signed link to the same file, for the build job to fetch.
  screenshot_url text,
  discord_user text,
  status text not null default 'open' check (status in ('open', 'building', 'fixed', 'question', 'sent_back', 'closed')),
  -- What the build job did, or the question it has.
  result text,
  -- What the owner said when sending it back.
  owner_note text,
  build_id uuid references public.fixit_builds(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);

create index if not exists fixit_tickets_org_status on public.fixit_tickets (organization_id, status);
create index if not exists fixit_tickets_build on public.fixit_tickets (build_id);

-- ---------------------------------------------------------------------------
-- Numbers: the next one for the business, under a lock so two tickets typed
-- at once can't both get #7.
-- ---------------------------------------------------------------------------
create or replace function public.fixit_next_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.organization_id::text));
    execute format('select coalesce(max(number), 0) + 1 from public.%I where organization_id = $1', tg_table_name)
      into new.number
      using new.organization_id;
  end if;
  return new;
end $$;

create or replace trigger fixit_builds_number before insert on public.fixit_builds
  for each row execute function public.fixit_next_number();
create or replace trigger fixit_tickets_number before insert on public.fixit_tickets
  for each row execute function public.fixit_next_number();

create or replace trigger set_updated_at before update on public.fixit_builds
  for each row execute function set_updated_at();
create or replace trigger set_updated_at before update on public.fixit_tickets
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access: admins of the business read; nobody signed in writes.
-- ---------------------------------------------------------------------------
alter table public.fixit_builds enable row level security;
alter table public.fixit_tickets enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fixit_builds' and policyname = 'fixit_builds_admin_read') then
    create policy fixit_builds_admin_read on public.fixit_builds
      for select to authenticated
      using (organization_id = (select current_org_id()) and (select is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fixit_tickets' and policyname = 'fixit_tickets_admin_read') then
    create policy fixit_tickets_admin_read on public.fixit_tickets
      for select to authenticated
      using (organization_id = (select current_org_id()) and (select is_admin()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Screenshots: a private bucket. The server uploads and signs links with the
-- service role; an admin may read (and upload to) their own business's
-- folder, no one else. Nothing is public.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fixit-screenshots', 'fixit-screenshots', false, 10485760, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fixit_screenshots_admin_read') then
    create policy fixit_screenshots_admin_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'fixit-screenshots'
        and (storage.foldername(name))[1] = (select current_org_id())::text
        and (select is_admin())
      );
  end if;
  -- The app uploads with the service role; this is the floor for an admin
  -- signed in, in their own folder only (same as the back-office buckets).
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fixit_screenshots_admin_insert') then
    create policy fixit_screenshots_admin_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'fixit-screenshots'
        and (storage.foldername(name))[1] = (select current_org_id())::text
        and (select is_admin())
      );
  end if;
end $$;

notify pgrst, 'reload schema';
