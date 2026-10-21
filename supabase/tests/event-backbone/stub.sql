-- Just enough of the live schema for 0370 and 0371 to run against a bare
-- Postgres: the roles Supabase provides, auth.uid(), current_org_id(), and
-- the tables the backbone and its views point at, with only the columns they
-- read. Never run against a real project.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.organizations (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key, organization_id uuid references public.organizations(id));
create or replace function public.current_org_id() returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid()
$$;
create table public.customers (id uuid primary key default gen_random_uuid(), organization_id uuid);
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  status text not null default 'estimating',
  evaluation_status text not null default 'scheduled',
  evaluation_date date
);
create table public.job_proposals (id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), status text, paid_at timestamptz);
create or replace function public.job_paid_in_full(the_job uuid) returns boolean language sql stable as $$
  select exists (select 1 from job_proposals p where p.job_id = the_job and p.paid_at is not null)
$$;
create table public.job_issues (id uuid primary key default gen_random_uuid(), organization_id uuid, job_id uuid, title text, severity text, owner_id uuid, due_at timestamptz, created_at timestamptz default now(), blocking boolean default false, status text default 'open');
create table public.job_exceptions (id uuid primary key default gen_random_uuid(), organization_id uuid, job_id uuid, summary text, blocks_work boolean default false, reported_at timestamptz default now(), state text default 'reported');
create table public.sales_exceptions (id uuid primary key default gen_random_uuid(), organization_id uuid, job_id uuid, summary text, assigned_to uuid, opened_at timestamptz default now(), state text default 'open');
create table public.client_automation_exceptions (id uuid primary key default gen_random_uuid(), organization_id uuid, job_id uuid, summary text, created_at timestamptz default now(), state text default 'open');
create table public.outbound_approvals (id uuid primary key default gen_random_uuid(), organization_id uuid, job_id uuid, subject text, expires_at timestamptz, created_at timestamptz default now(), status text default 'pending');
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter table public.jobs enable row level security;
create policy jobs_org on public.jobs for all to authenticated using (organization_id = current_org_id());
