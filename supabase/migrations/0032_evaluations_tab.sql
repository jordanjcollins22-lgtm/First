-- New "My Evaluations" tab for the dedicated evaluator workflow page.
-- Grant it to admin/crew by default so nothing that already worked regresses;
-- create an "evaluator" role from the Team page and grant just this tab (plus
-- "new-property") there to build the restricted evaluator-only view.
insert into role_permissions (role_name, tab_key)
select r.role_name, 'evaluations'
from (values ('admin'), ('crew')) as r(role_name)
on conflict do nothing;
