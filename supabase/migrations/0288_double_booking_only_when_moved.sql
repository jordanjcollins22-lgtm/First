-- The double-booking guard fires only when a visit is booked or moved.
--
-- It also ran whenever a job's status changed, and a visit that had
-- already happened then failed the check against another old visit: a
-- job from August could not be marked quoted because Jace had two
-- evaluations half an hour apart that afternoon. A completed visit
-- cannot be double-booked, and a status change moves nobody.
create or replace function assert_evaluation_free() returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $$
begin
  if new.assigned_to is null or new.evaluation_date is null
     or new.status = 'cancelled' or new.evaluation_status in ('cancelled', 'completed') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.assigned_to is not distinct from new.assigned_to
     and old.evaluation_date is not distinct from new.evaluation_date
     and old.evaluation_end_date is not distinct from new.evaluation_end_date
     and (old.status = 'cancelled') is not distinct from (new.status = 'cancelled')
     and (old.evaluation_status = 'cancelled') is not distinct from (new.evaluation_status = 'cancelled') then
    return new;
  end if;

  perform raise_double_booking(
    new.assigned_to,
    new.evaluation_date,
    coalesce(new.evaluation_end_date, new.evaluation_date + interval '60 minutes'),
    new.id
  );
  return new;
end;
$$;
