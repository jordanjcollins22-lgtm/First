-- Indeed applicants who were sent our application link automatically.
--
-- Indeed's "someone applied" email reaches the app's hiring address; the app
-- writes back to the applicant's Indeed address with the link to our own
-- application. One row per application email, so the same email delivered
-- twice sends once, and a person who applied to several jobs is written to
-- once.

create table if not exists public.indeed_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The received email's id at the provider: the same delivery twice is one row.
  email_id text not null unique,
  name text,
  position text not null,
  -- The indeedemail.com address that reaches them, when the email had one.
  relay text,
  -- sent: the link went. no_address: nowhere to write, the owner was told.
  -- repeat: already written to for another job. failed: the send failed.
  status text not null check (status in ('sent', 'no_address', 'repeat', 'failed')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists indeed_invites_org_idx on public.indeed_invites (organization_id, created_at desc);
create index if not exists indeed_invites_relay_idx on public.indeed_invites (organization_id, relay) where relay is not null;

alter table public.indeed_invites enable row level security;

-- Read by the people who review applicants; written only by the server.
drop policy if exists indeed_invites_read on public.indeed_invites;
create policy indeed_invites_read on public.indeed_invites for select to authenticated
  using ((select is_admin()));
