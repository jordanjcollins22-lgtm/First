-- The evaluation calendar already existed as a built-in view of the schedule
-- before calendars were a record. This gives every org a matching "Evaluations"
-- row so it shows up in Calendar Settings alongside any calendars the business
-- adds, and marks it as a system calendar so it can be renamed, recolored, and
-- staffed but not deleted out from under the schedule that depends on it.

alter table calendars add column if not exists is_system boolean not null default false;

insert into calendars (organization_id, name, color, description, is_system)
select o.id, 'Evaluations', '#2f6d3c', 'On-site property evaluations.', true
from organizations o
where not exists (
  select 1 from calendars c where c.organization_id = o.id and c.is_system
);

notify pgrst, 'reload schema';
