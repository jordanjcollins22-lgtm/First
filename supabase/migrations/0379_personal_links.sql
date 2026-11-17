-- Each person's own link to their page: app.jslandscapingmd.com/p/<dashboard_slug>.
-- It still asks them to sign in; it fills in their email and, once signed in,
-- opens their own role's page. Their first name plus four random letters, so
-- it reads as theirs but can't be guessed from a name.
--
-- Also gives everybody an affiliate link (/book?ref=<affiliate_slug>) who
-- doesn't have one yet: technicians and up have one as well as affiliates.

alter table profiles add column if not exists dashboard_slug text unique;

-- plpgsql so each call draws its own letters (a plain SQL subquery is drawn
-- once per statement, which gives everybody the same four).
create or replace function personal_slug(full_name text, email text) returns text
language plpgsql volatile as $$
declare
  base text;
  tail text := '';
  abc constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
begin
  base := coalesce(nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), ''), split_part(coalesce(email, ''), '@', 1));
  base := coalesce(nullif(left(regexp_replace(lower(base), '[^a-z0-9]', '', 'g'), 20), ''), 'me');
  for i in 1..4 loop
    tail := tail || substr(abc, 1 + floor(random() * length(abc))::int, 1);
  end loop;
  return base || '-' || tail;
end $$;

update profiles set dashboard_slug = personal_slug(full_name, email) where dashboard_slug is null;
update profiles set affiliate_slug = substr(md5(random()::text || id::text), 1, 10) where affiliate_slug is null;

-- Everybody added from now on gets both when their profile is made.
create or replace function profiles_fill_links() returns trigger
language plpgsql as $$
begin
  if new.dashboard_slug is null then new.dashboard_slug := personal_slug(new.full_name, new.email); end if;
  if new.affiliate_slug is null then new.affiliate_slug := substr(md5(random()::text || new.id::text), 1, 10); end if;
  return new;
end $$;

drop trigger if exists profiles_fill_links on profiles;
create trigger profiles_fill_links before insert on profiles
  for each row execute function profiles_fill_links();
