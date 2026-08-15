-- Being an affiliate is now something an admin grants explicitly, rather than
-- being inferred purely from carrying the evaluator or account-manager role.
-- Anyone who qualified under the old rule is marked so nobody loses the link
-- they've already been handing out.

alter table profiles add column if not exists is_affiliate boolean not null default false;

update profiles
set is_affiliate = true
where is_affiliate = false
  and exists (
    select 1 from profile_roles pr
    where pr.profile_id = profiles.id
      and lower(replace(replace(pr.role_name, '_', ' '), '  ', ' ')) in ('evaluator', 'account manager')
  );

notify pgrst, 'reload schema';
