-- When the GoHighLevel calendar was last read.
--
-- The app reads the calendar when somebody opens the Calendar or My Day,
-- at most every few minutes, and once a day on its own. This is the clock
-- that stops every page load asking GoHighLevel again.

create table if not exists ghl_sync_state (
  organization_id uuid primary key references organizations(id) on delete cascade,
  last_pulled_at timestamptz,
  last_result text
);

alter table ghl_sync_state enable row level security;

drop policy if exists "ghl_sync_state_org_read" on ghl_sync_state;
create policy "ghl_sync_state_org_read" on ghl_sync_state for select to authenticated
  using (organization_id = current_org_id());
