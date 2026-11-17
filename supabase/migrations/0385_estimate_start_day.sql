-- The day a deposit client would like the work to start.
--
-- A deposit and a paid evaluation differ in what the first visit is: after
-- a deposit the crew comes to work (confirming the estimate on arrival),
-- after a paid evaluation the evaluator comes to evaluate. The evaluation is
-- booked into an evaluator's time slot; the work day is a preference the
-- client picks, which the scheduler reads like an accepted proposal's chosen
-- day and the team confirms with the client. Null until they pick one.
alter table job_estimates add column if not exists start_day date;
