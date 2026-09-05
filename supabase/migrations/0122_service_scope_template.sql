-- The wording a client reads about a service.
--
-- Every zone on a proposal prints a heading and a paragraph under it. That
-- paragraph came only from the built-in service catalogue compiled into the
-- app, which knows nothing about a service this business invented — so a
-- custom service printed a heading and nothing at all, eight times over on
-- one proposal.
--
-- This is where the business writes its own. Editable per service on the
-- Services screen, and used for built-in services too, so wording anybody
-- disagrees with can be fixed without a deploy.

alter table services add column if not exists scope_template text;

comment on column services.scope_template is
  'What a client is told this service covers. Falls back to the built-in wording when blank, and is itself overridden by anything typed on the individual zone — that was written standing in the garden.';

notify pgrst, 'reload schema';
