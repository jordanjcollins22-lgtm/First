-- How many homes the outline actually encloses.
--
-- A court's house_count is the homes on that street, read off their
-- addresses. Its outline is a ring somebody may have dragged wider or
-- tighter, and the number that matters to operations is how many doors are
-- inside the ring as drawn. Counted off the spatial index when the ring
-- changes, and on demand.

alter table court_targets add column if not exists inside_house_count integer;

-- Count the homes inside one court's current ring: the drawn one if there
-- is one, else the built one.
create or replace function public.court_inside_count(the_court uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  c record;
  ring jsonb;
  n integer;
begin
  select id, organization_id, coalesce(custom_outline, outline) as o into c from court_targets where id = the_court;
  if c is null then return null; end if;
  -- houses_in_shape wants an open ring; the stored one is closed.
  ring := (select jsonb_agg(p) from (select p from jsonb_array_elements(c.o) with ordinality as t(p, i) where i < jsonb_array_length(c.o) order by i) s);
  select count(*)::integer into n from houses_in_shape(c.organization_id, ring, null);
  update court_targets set inside_house_count = n where id = the_court;
  return n;
end;
$$;
