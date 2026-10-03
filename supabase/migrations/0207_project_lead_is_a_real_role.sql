-- Project Lead exists.
--
-- The app has been talking about a project lead for a while and the database
-- has never had one. What it had was `crew`, and a lead was whichever crew
-- member somebody ticked `is_lead` on for one job. That works right up until
-- the question is "what may a lead see" -- because the answer has to come from
-- a role, and there was no role.
--
-- So: `project lead` is a real role now. Nobody is put in it by this migration.
-- Renaming somebody's role is a decision about a person, and a migration that
-- moved three crew members into a new role would be making that decision at
-- three in the morning with nobody watching. An admin moves them in Settings,
-- one at a time, and until they do nothing about anybody's access changes.
--
-- The second half of this file is the part that would otherwise be a quiet
-- outage. `tabsAllowedForRoles` gives an admin any tab that *no role has been
-- granted at all* -- a page nobody has decided about stays reachable by whoever
-- has to make the decision. Granting a tab to `project lead` therefore takes it
-- away from admins, because the tab stops being undecided. Five tabs are in
-- that position, so they are granted to admin explicitly, first, in the same
-- transaction. Admin ends with exactly the access it has today, written down
-- rather than inferred.
--
-- Everything else is left alone deliberately. This is not the migration that
-- fills in the whole matrix; it is the one that adds a role without changing
-- what anybody already has.

INSERT INTO public.roles (name, is_system) VALUES ('project lead', false)
ON CONFLICT (name) DO NOTHING;

-- The tabs a Project Lead is granted. First, keep admin's implicit access to
-- them by writing it down -- before the grants below make them "decided".
INSERT INTO public.role_permissions (role_name, tab_key)
SELECT 'admin', k FROM unnest(ARRAY[
  'job-detail',       -- the job they are running
  'weather',          -- whether it can be run
  'labels',           -- the sticker on the saw
  'inventory-setup',
  'weeds'             -- the field guide
]) AS k
ON CONFLICT (role_name, tab_key) DO NOTHING;

INSERT INTO public.role_permissions (role_name, tab_key)
SELECT 'project lead', k FROM unnest(ARRAY[
  'job-detail',
  'evaluations',      -- the calendar: when their work is
  'weather',
  'conversations',
  'conversation-job', -- the client thread for a job they are running
  'tools',
  'materials',
  'labels',
  'inventory-setup',
  'weeds'
]) AS k
ON CONFLICT (role_name, tab_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
