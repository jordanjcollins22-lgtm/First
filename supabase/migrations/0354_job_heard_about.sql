-- "How did you hear about us?", asked on every booking.
--
-- Most evaluations booked before this had no source, so nobody could say
-- which marketing was bringing in work. The public booking page and the
-- office's phone booking now both require an answer, kept on the job (not
-- the customer) because a returning client can find us a different way the
-- second time. Older jobs stay null.
alter table jobs add column if not exists heard_about text;
