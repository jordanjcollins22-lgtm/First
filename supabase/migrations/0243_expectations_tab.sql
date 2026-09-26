-- Who can read the expectations briefing.
--
-- Training an evaluator cannot be gated on being an admin. The whole point of
-- the page is that the person standing on somebody's lawn has read it, and
-- that person is an evaluator, an account manager or a project lead, none of
-- whom hold the admin role.
--
-- Crew are included deliberately. They are the ones a client corners in the
-- driveway two weeks later to ask why the lawn still looks thin, and "seed
-- takes two seasons to thicken and you are three weeks in" is a far better
-- answer than a shrug and a promise to pass it on.
--
-- Owner is granted explicitly. Admins are given any tab nobody has been
-- denied, so they keep it whatever happens here, but `owner` holds its access
-- as real rows and would quietly lose a tab the moment somebody else gained
-- one. Granted first, in the same transaction, so nobody's access narrows.
insert into role_permissions (role_name, tab_key, granted)
select r.role_name, 'expectations', true
from (values ('owner'), ('admin'), ('evaluator'), ('account manager'), ('project lead'), ('crew'))
  as r(role_name)
where exists (select 1 from roles where roles.name = r.role_name)
on conflict (role_name, tab_key) do nothing;

notify pgrst, 'reload schema';
