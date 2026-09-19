-- How a message to the client went out: shown on their page only, emailed,
-- or texted. Null on team notes and on anything older than this column.
alter table job_messages add column if not exists sent_via text
  check (sent_via is null or sent_via in ('app', 'email', 'sms'));
