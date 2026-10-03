-- A new account is not a member of staff.
--
-- The signup trigger gave every new auth user a profile in this business and
-- the crew role, falling back to a hardcoded organization when the signup
-- carried none. That was survivable only because nobody could sign up: staff
-- are created server-side by an admin, and that path always sets
-- organization_id in the user's metadata.
--
-- It stops being survivable the moment clients can make their own accounts
-- from the booking form. Crew can open Conversations and the Calendar, which
-- is every client thread and every evaluation with an address and a time on
-- it. A homeowner booking a lawn quote would have got a staff login into the
-- business.
--
-- So the fallback goes. A signup that names an organization is somebody an
-- admin created and gets exactly what it got before; a signup that does not
-- gets an auth account and nothing else — no profile, no role, and therefore
-- no page in the app, because every guard starts by asking for a profile.
--
-- Nothing about the existing staff paths changes: both of them already pass
-- organization_id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  target_org_id := (new.raw_user_meta_data->>'organization_id')::uuid;

  -- No organization named, so this is not a staff account being created by an
  -- admin. It gets an identity and no access. Clients live in `customers`.
  if target_org_id is null then
    return new;
  end if;

  insert into public.profiles (id, email, organization_id)
  values (new.id, new.email, target_org_id)
  on conflict (id) do nothing;

  insert into public.profile_roles (profile_id, role_name)
  values (new.id, 'crew')
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Creates a staff profile only for signups that name an organization, which is how the admin-created paths do it. Anything else — a client making an account from the booking form — gets an auth identity and no access at all.';

-- Which auth account belongs to which client, so a signed-in homeowner can be
-- shown their own work and nobody else's.
alter table customers add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

comment on column customers.auth_user_id is
  'The passwordless account this client signs in with. Null until they book through the funnel or ask for a code.';

create index if not exists customers_auth_user_idx on customers (auth_user_id) where auth_user_id is not null;

notify pgrst, 'reload schema';
