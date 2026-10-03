-- Public client-facing booking flow: a client clicks an ad (the org's own
-- link) or a specific evaluator/account manager's personal affiliate link,
-- lands on /book, and books an evaluation straight into an evaluator's real
-- availability. Both link types resolve to an organization via a slug —
-- affiliate_slug on the person, slug on the org for the generic/ad link.
--
-- All writes from /book go through the service-role client (no logged-in
-- user exists yet) — the same pattern already used by the GHL webhook.

alter table profiles add column if not exists affiliate_slug text unique;
alter table organizations add column if not exists slug text unique;

-- Backfill a slug for any existing organization so the "ad" link works
-- immediately without an admin having to open the new page first.
update organizations
set slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) || '-' || substr(id::text, 1, 8)
where slug is null;

alter table jobs add column if not exists client_notes text;
alter table jobs add column if not exists budget_range text;
alter table jobs add column if not exists referred_by_profile_id uuid references profiles(id);

-- Which services the client said they want, from the public wizard —
-- separate from service_materials/service_tools, which describe what a
-- service needs, not what a specific lead asked for.
create table if not exists job_requested_services (
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  service_type_id text not null,
  created_at timestamptz not null default now(),
  primary key (job_id, service_type_id),
  foreign key (organization_id, service_type_id) references services(organization_id, service_type_id)
);

alter table job_requested_services enable row level security;
drop policy if exists "org_scoped_job_requested_services" on job_requested_services;
create policy "org_scoped_job_requested_services" on job_requested_services for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
