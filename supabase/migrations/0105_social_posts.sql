-- Before-and-after posts, from photographs we already take.
--
-- Every job already has a before and an after of every zone, because a job
-- cannot be signed off without them. Nobody ever does anything with them.
-- This is the queue that does: one row per pair, approved by a person, given
-- a time, and shown back on the customer's job once it is out.

create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,

  -- The pair this was made from. Kept so the post can be traced back to the
  -- photographs rather than only to the flattened image.
  before_photo_id uuid references job_photos(id) on delete set null,
  after_photo_id uuid references job_photos(id) on delete set null,
  zone_id text,
  zone_name text,

  -- The finished square, ready to post. Written once, at approval.
  image_path text,
  caption text,

  -- draft     — made, nobody has looked
  -- approved  — a person said yes, waiting on a slot
  -- scheduled — has a time
  -- posted    — out
  -- skipped   — looked at and turned down, so it never comes back round
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'scheduled', 'posted', 'skipped')),

  scheduled_for timestamptz,
  posted_at timestamptz,
  channel text,

  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One post per pair. Re-running the finder must not stack duplicates of the
  -- same transformation in the queue.
  unique (before_photo_id, after_photo_id)
);

create index if not exists social_posts_job_idx on social_posts(job_id, created_at);
create index if not exists social_posts_due_idx
  on social_posts(status, scheduled_for) where status = 'scheduled';
create index if not exists social_posts_org_idx on social_posts(organization_id, status);

alter table social_posts enable row level security;
drop policy if exists "org_scoped_social_posts" on social_posts;
create policy "org_scoped_social_posts" on social_posts for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- The finished images. Public, unlike job-photos: a post is a thing meant to
-- be seen, and it only exists once somebody approved it being seen.
insert into storage.buckets (id, name, public)
values ('social-posts', 'social-posts', true)
on conflict (id) do nothing;

drop policy if exists "read_social_posts" on storage.objects;
create policy "read_social_posts"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'social-posts');

drop policy if exists "write_social_posts" on storage.objects;
create policy "write_social_posts"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'social-posts');

drop policy if exists "update_social_posts" on storage.objects;
create policy "update_social_posts"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'social-posts');

drop policy if exists "delete_social_posts" on storage.objects;
create policy "delete_social_posts"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'social-posts');

notify pgrst, 'reload schema';
