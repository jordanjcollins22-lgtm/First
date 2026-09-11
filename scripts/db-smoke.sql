-- Smoke test for supabase/migrations/0003_winter_pass.sql. Runs in CI against a
-- scratch Postgres and locally via `npm run db:smoke`. Every statement must succeed.
\set ON_ERROR_STOP on
begin;

insert into slot_inventory (season, total_slots) values ('test', 1) on conflict do nothing;
insert into optimizer_state (id) values (true) on conflict do nothing;
insert into sessions (id) values ('00000000-0000-0000-0000-000000000001');
insert into orders (id, session_id, season, plan, payment_type, salt_price_cents, subtotal_cents, total_cents,
  customer_name, email, phone, address_line1, city, zip, schedule_hold)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','test','full_winter_pass',
  'pay_in_full',54900,94800,85320,'Test','t@example.com','4105551212','1 Main St','Bel Air','21014',true);
insert into orders (id, season, plan, payment_type, salt_price_cents, subtotal_cents, total_cents,
  customer_name, email, phone, address_line1, city, zip, schedule_hold)
values ('10000000-0000-0000-0000-000000000002','test','full_winter_pass','monthly',54900,94800,94800,
  'Two','u@example.com','4105551213','2 Main St','Bel Air','21014',true);

-- capacity math
do $$
begin
  assert remaining_slots('test') = 1, 'fresh season should have 1 slot';
  perform reserve_slot('10000000-0000-0000-0000-000000000001', 'test');
  assert remaining_slots('test') = 0, 'hold should consume the slot';
  begin
    perform reserve_slot('10000000-0000-0000-0000-000000000002', 'test');
    raise exception 'second hold should have failed';
  exception when sqlstate 'P0001' then null;
  end;
  perform confirm_slot('10000000-0000-0000-0000-000000000001');
  assert remaining_slots('test') = 0, 'confirmed slot stays consumed';
  perform release_slot('10000000-0000-0000-0000-000000000001');
  assert remaining_slots('test') = 1, 'release frees the slot';
  perform reserve_slot('10000000-0000-0000-0000-000000000002', 'test', interval '-1 minute');
  assert remaining_slots('test') = 1, 'expired hold does not count';
  assert expire_slot_holds() = 1, 'expire should release exactly one';
end $$;

-- constraints
do $$
begin
  begin
    insert into events (name) values ('bogus'); raise exception 'event name check missing';
  exception when check_violation then null; end;
  begin
    insert into legal_acceptances (purpose, document, content_hash) values ('checkout','x.md','nothex');
    raise exception 'legal hash check missing';
  exception when check_violation then null; end;
  begin
    insert into optimizer_state (id) values (false); raise exception 'singleton check missing';
  exception when check_violation then null; end;
end $$;

-- views
insert into experiments (key, scope) values ('headline','landing');
insert into experiment_arms (experiment_key, arm_id) values ('headline','h1');
insert into assignments (session_id, experiment_key, arm_id) values ('00000000-0000-0000-0000-000000000001','headline','h1');
update orders set status = 'paid' where id = '10000000-0000-0000-0000-000000000001';
insert into events (session_id, name, revenue_cents, order_id)
values ('00000000-0000-0000-0000-000000000001','purchase',85320,'10000000-0000-0000-0000-000000000001');
do $$
declare s arm_stats;
begin
  select * into s from arm_stats where experiment_key = 'headline' and arm_id = 'h1';
  assert s.sessions = 1 and s.purchases = 1 and s.revenue_cents = 85320, 'arm_stats wrong';
  assert (select purchases from daily_funnel limit 1) = 1, 'daily_funnel wrong';
end $$;

-- security
do $$
begin
  assert (select bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in
    ('sessions','experiments','experiment_arms','assignments','events','slot_inventory','slot_reservations',
     'orders','legal_acceptances','leads','optimizer_state','offer_changes','proposals','weekly_reports','webhook_events')),
    'RLS must be enabled on every funnel table';
  assert (select count(*) from information_schema.role_table_grants
          where grantee in ('anon','authenticated') and table_name in ('orders','events','sessions','leads','legal_acceptances')) = 0,
    'anon/authenticated must have no grants on funnel tables';
end $$;

rollback;
\echo db-smoke: all assertions passed
