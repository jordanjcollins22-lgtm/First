-- Pay can now be hourly, commission, or BOTH (an hourly rate plus a % of
-- sales). People with an hourly component (hourly or both) feed the blended
-- crew cost per hour.
alter table profiles drop constraint if exists profiles_pay_type_check;
alter table profiles add constraint profiles_pay_type_check
  check (pay_type in ('hourly', 'commission', 'both'));
