-- The evaluator's visit, from the evaluator's own screen.
--
-- evaluator_on_way_at and evaluator_arrived_at: when they tapped "On my way"
-- and "I've arrived". Kept on the job rather than in the crew's day log,
-- which is a strict shop-to-stops sequence an evaluator never follows.
--
-- evaluation_plan: the site map set-up they went through on site. Each
-- piece of work from the client's pre-evaluation form, and anything they
-- added, with Keep or Remove:
-- [{id, area, service, typeId, label, keep, added}]. The kept ones become
-- zones on the site map.
alter table jobs add column if not exists evaluator_on_way_at timestamptz;
alter table jobs add column if not exists evaluator_arrived_at timestamptz;
alter table jobs add column if not exists evaluation_plan jsonb;
