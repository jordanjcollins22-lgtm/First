-- Each service carries a general "how to" writeup, and each tool can carry a
-- YouTube link showing how to use it. Together with the service's tool
-- checklist (service_tools — now editable right on the service, same as
-- materials), a crew opening a zone sees what to grab and how to do the work.
alter table services add column if not exists how_to text;
alter table tools add column if not exists how_to_url text;
