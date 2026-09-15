-- Applied directly to the live database via the Supabase MCP connection —
-- recorded here for the repo's history.
--
-- 1. Merged/removed duplicate customer records (multiple "Amy Willig",
--    "Joanna Ambridge", "Mike" rows, plus one empty "brit" shell) down to one
--    real record per person, keeping whichever had actual email/phone/
--    property/job data attached.
-- 2. Fixed a job name that never got renamed when its property's address was
--    corrected (address itself was already right, only the label was stale).
-- 3. Hardened set_updated_at() with a fixed search_path, matching the other
--    trigger/security-definer functions (flagged by Supabase's advisor).

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
