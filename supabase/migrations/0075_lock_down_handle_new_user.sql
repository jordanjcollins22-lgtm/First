-- handle_new_user() only ever runs as a trigger when an account is created,
-- but it was reachable over the public API as /rest/v1/rpc/handle_new_user by
-- anyone, signed in or not. It's security definer, so it runs with the
-- owner's rights — nothing should be able to call it directly.
--
-- The trigger is unaffected: triggers don't go through execute grants.
--
-- The other security-definer helpers (current_org_id, has_role, is_admin,
-- is_superadmin) stay callable on purpose — RLS policies invoke them, and
-- they return nothing useful without a session.

revoke execute on function public.handle_new_user() from anon, authenticated, public;

notify pgrst, 'reload schema';
