-- Pay can be hourly or commission-based per person. Only hourly people feed
-- the blended crew cost per hour (commission isn't a per-hour labor cost);
-- commission_pct is the percent of the sale that person earns.
alter table profiles add column if not exists pay_type text not null default 'hourly';
alter table profiles drop constraint if exists profiles_pay_type_check;
alter table profiles add constraint profiles_pay_type_check
  check (pay_type in ('hourly', 'commission'));
alter table profiles add column if not exists commission_pct numeric;
