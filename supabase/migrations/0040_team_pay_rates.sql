-- Crew cost per hour stops being a hand-typed guess: each team member gets a
-- pay rate, and the blended crew cost used by the service COGS calculator is
-- the average of everyone with a rate set. organizations.crew_cost_per_hour
-- stays only as a fallback for businesses that haven't entered pay yet.
alter table profiles add column if not exists pay_rate_per_hour numeric;
