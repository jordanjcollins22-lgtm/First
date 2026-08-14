-- Multi-tenant isolation: every business (organization) gets its own
-- customers, properties, jobs, evaluations, tool/material/service catalog,
-- pricing, business locations, and overhead — enforced at the database
-- level via row-level security, not just hidden in the UI.
--
-- Role DEFINITIONS (admin/crew/evaluator/overhead and which tabs they see)
-- stay shared, global infrastructure — not business data, and duplicating
-- them per organization would add a lot of complexity for no real privacy
-- benefit. attractor_types/attractor_variants (the marketing-method
-- taxonomy: "Yard Sign", "Google Ads", etc.) stay global for the same
-- reason — only the actual attractor_waves (real campaign data) are scoped.
--
-- Existing data becomes the first organization. Only
-- jordan@jslandscapingmd.com can create new ones (checked by email, both in
-- RLS and in the server action that creates them) — that account is also
-- the only one that can see the organizations table beyond its own row.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on organizations;
create trigger set_updated_at before update on organizations for each row execute function set_updated_at();

-- Fixed id (not gen_random_uuid()) so this migration and the fallback in
-- handle_new_user() below can both reference it without a lookup.
insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'JS Landscaping MD')
on conflict (id) do nothing;

-- ============================================================
-- profiles.organization_id — every account belongs to exactly one org.
-- ============================================================
alter table profiles add column if not exists organization_id uuid references organizations(id);
update profiles set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table profiles alter column organization_id set not null;
alter table profiles alter column organization_id set default '00000000-0000-0000-0000-000000000001';

create or replace function current_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from profiles where id = auth.uid();
$$;

-- Only this one account, checked by email, can create/see other
-- organizations. Everyone else — including other admins — is scoped to
-- their own organization_id like any other account.
create or replace function is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and lower(email) = 'jordan@jslandscapingmd.com'
  );
$$;

-- New accounts get their organization from user_metadata (set explicitly by
-- the server action that creates them — see createTeamMember/
-- createOrganization in the app), falling back to the default org if it's
-- ever missing rather than failing the signup outright.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  target_org_id := coalesce(
    (new.raw_user_meta_data->>'organization_id')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );
  insert into public.profiles (id, email, organization_id)
  values (new.id, new.email, target_org_id)
  on conflict (id) do nothing;
  insert into public.profile_roles (profile_id, role_name)
  values (new.id, 'crew')
  on conflict do nothing;
  return new;
end;
$$;

alter table organizations enable row level security;
drop policy if exists "read_own_org_or_superadmin" on organizations;
create policy "read_own_org_or_superadmin" on organizations for select to authenticated
  using (is_superadmin() or id = current_org_id());
drop policy if exists "superadmin_insert_organizations" on organizations;
create policy "superadmin_insert_organizations" on organizations for insert to authenticated
  with check (is_superadmin());
drop policy if exists "superadmin_update_organizations" on organizations;
create policy "superadmin_update_organizations" on organizations for update to authenticated
  using (is_superadmin()) with check (is_superadmin());

-- Team rosters are visible platform-wide to the superadmin (low-sensitivity —
-- just who exists and their role, not their business data), but each
-- organization's admin only manages their own people.
drop policy if exists "read_all_profiles" on profiles;
create policy "read_own_org_profiles" on profiles for select to authenticated
  using (is_superadmin() or organization_id = current_org_id());
drop policy if exists "admin_manage_profiles" on profiles;
create policy "admin_manage_own_org_profiles" on profiles for update to authenticated
  using (is_admin() and organization_id = current_org_id())
  with check (is_admin() and organization_id = current_org_id());

-- ============================================================
-- customers — root of the customer/property/job/canvas_design tree.
-- ============================================================
alter table customers add column if not exists organization_id uuid references organizations(id);
update customers set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table customers alter column organization_id set not null;
alter table customers alter column organization_id set default '00000000-0000-0000-0000-000000000001';

drop policy if exists "authenticated_full_access" on customers;
create policy "org_scoped_customers" on customers for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "authenticated_full_access" on properties;
create policy "org_scoped_properties" on properties for all to authenticated
  using (exists (select 1 from customers c where c.id = properties.customer_id and c.organization_id = current_org_id()))
  with check (exists (select 1 from customers c where c.id = properties.customer_id and c.organization_id = current_org_id()));

drop policy if exists "authenticated_full_access" on jobs;
create policy "org_scoped_jobs" on jobs for all to authenticated
  using (exists (
    select 1 from properties p join customers c on c.id = p.customer_id
    where p.id = jobs.property_id and c.organization_id = current_org_id()
  ))
  with check (exists (
    select 1 from properties p join customers c on c.id = p.customer_id
    where p.id = jobs.property_id and c.organization_id = current_org_id()
  ));

drop policy if exists "authenticated_full_access" on canvas_designs;
create policy "org_scoped_canvas_designs" on canvas_designs for all to authenticated
  using (exists (
    select 1 from jobs j join properties p on p.id = j.property_id join customers c on c.id = p.customer_id
    where j.id = canvas_designs.job_id and c.organization_id = current_org_id()
  ))
  with check (exists (
    select 1 from jobs j join properties p on p.id = j.property_id join customers c on c.id = p.customer_id
    where j.id = canvas_designs.job_id and c.organization_id = current_org_id()
  ));

-- ============================================================
-- tools / materials — each org's own inventory and costs.
-- ============================================================
alter table tools add column if not exists organization_id uuid references organizations(id);
update tools set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table tools alter column organization_id set not null;
alter table tools alter column organization_id set default '00000000-0000-0000-0000-000000000001';
alter table tools drop constraint if exists tools_name_key;
alter table tools drop constraint if exists tools_organization_id_name_key;
alter table tools add constraint tools_organization_id_name_key unique (organization_id, name);

alter table materials add column if not exists organization_id uuid references organizations(id);
update materials set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table materials alter column organization_id set not null;
alter table materials alter column organization_id set default '00000000-0000-0000-0000-000000000001';
alter table materials drop constraint if exists materials_name_key;
alter table materials drop constraint if exists materials_organization_id_name_key;
alter table materials add constraint materials_organization_id_name_key unique (organization_id, name);

drop policy if exists "authenticated_full_access" on tools;
create policy "org_scoped_tools" on tools for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "authenticated_full_access" on materials;
create policy "org_scoped_materials" on materials for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "authenticated_full_access" on service_tools;
create policy "org_scoped_service_tools" on service_tools for all to authenticated
  using (exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = current_org_id()))
  with check (exists (select 1 from tools t where t.id = service_tools.tool_id and t.organization_id = current_org_id()));

drop policy if exists "authenticated_full_access" on service_materials;
create policy "org_scoped_service_materials" on service_materials for all to authenticated
  using (exists (select 1 from materials m where m.id = service_materials.material_id and m.organization_id = current_org_id()))
  with check (exists (select 1 from materials m where m.id = service_materials.material_id and m.organization_id = current_org_id()));

-- ============================================================
-- services — pricing/time estimates. service_type_id was the primary key
-- alone; now composite with organization_id since it's per-org pricing.
-- ============================================================
alter table services add column if not exists organization_id uuid references organizations(id);
update services set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table services alter column organization_id set not null;
alter table services alter column organization_id set default '00000000-0000-0000-0000-000000000001';
alter table services drop constraint if exists services_pkey;
alter table services add primary key (organization_id, service_type_id);

drop policy if exists "authenticated_full_access" on services;
create policy "org_scoped_services" on services for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ============================================================
-- business_locations / location_areas — each org's own service area(s).
-- ============================================================
alter table business_locations add column if not exists organization_id uuid references organizations(id);
update business_locations set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table business_locations alter column organization_id set not null;
alter table business_locations alter column organization_id set default '00000000-0000-0000-0000-000000000001';

drop policy if exists "authenticated_full_access" on business_locations;
create policy "org_scoped_business_locations" on business_locations for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "authenticated_full_access" on location_areas;
create policy "org_scoped_location_areas" on location_areas for all to authenticated
  using (exists (select 1 from business_locations bl where bl.id = location_areas.location_id and bl.organization_id = current_org_id()))
  with check (exists (select 1 from business_locations bl where bl.id = location_areas.location_id and bl.organization_id = current_org_id()));

-- ============================================================
-- attractor_waves — real campaign data, per org. attractor_types/variants
-- (the shared taxonomy) are left untouched/global.
-- ============================================================
alter table attractor_waves add column if not exists organization_id uuid references organizations(id);
update attractor_waves set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table attractor_waves alter column organization_id set not null;
alter table attractor_waves alter column organization_id set default '00000000-0000-0000-0000-000000000001';

drop policy if exists "authenticated_full_access" on attractor_waves;
create policy "org_scoped_attractor_waves" on attractor_waves for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ============================================================
-- overhead_expenses — each org's own overhead, still gated on the
-- "overhead" role within that org (see 0028_role_permissions.sql).
-- ============================================================
alter table overhead_expenses add column if not exists organization_id uuid references organizations(id);
update overhead_expenses set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table overhead_expenses alter column organization_id set not null;
alter table overhead_expenses alter column organization_id set default '00000000-0000-0000-0000-000000000001';

drop policy if exists "jordan_manage_overhead" on overhead_expenses;
drop policy if exists "overhead_role_manage_overhead" on overhead_expenses;
create policy "org_scoped_overhead" on overhead_expenses for all to authenticated
  using (organization_id = current_org_id() and has_role('overhead'))
  with check (organization_id = current_org_id() and has_role('overhead'));

-- ============================================================
-- custom_field_options — per-org "Other" values, so one org's custom entry
-- doesn't show up as a suggestion in another org's dropdown.
-- ============================================================
alter table custom_field_options add column if not exists organization_id uuid references organizations(id);
update custom_field_options set organization_id = '00000000-0000-0000-0000-000000000001' where organization_id is null;
alter table custom_field_options alter column organization_id set not null;
alter table custom_field_options alter column organization_id set default '00000000-0000-0000-0000-000000000001';
alter table custom_field_options drop constraint if exists custom_field_options_service_type_id_field_key_value_key;
alter table custom_field_options drop constraint if exists custom_field_options_org_service_field_value_key;
alter table custom_field_options add constraint custom_field_options_org_service_field_value_key
  unique (organization_id, service_type_id, field_key, value);

drop policy if exists "authenticated_full_access" on custom_field_options;
create policy "org_scoped_custom_field_options" on custom_field_options for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
