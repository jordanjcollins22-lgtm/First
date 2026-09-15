-- An office role that carries no money.
--
-- "overhead" is the bookkeeper: it reads the ledger, payroll and overhead
-- expenses, because that is the job. Somebody answering messages, posting
-- outreach and drawing targets on the map works in the office too, and has
-- no business in the ledger. "office" is that person: the office's screens
-- and the crew's whereabouts, and not one money table.

insert into roles (name) values ('office') on conflict do nothing;

drop policy if exists "crew_day_events_office_read" on crew_day_events;
create policy "crew_day_events_office_read" on crew_day_events for select to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'owner', 'overhead', 'office')
    )
  );

drop policy if exists "crew_positions_office_read" on crew_positions;
create policy "crew_positions_office_read" on crew_positions for select to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'owner', 'overhead', 'office', 'account manager')
    )
  );

drop policy if exists "loadout_checks_office_read" on loadout_checks;
create policy "loadout_checks_office_read" on loadout_checks for select to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'owner', 'overhead', 'office')
    )
  );
