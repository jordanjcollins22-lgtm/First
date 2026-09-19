-- What opened the link, at the coarsest useful grain.
--
-- A link posted in a Facebook comment is fetched a dozen times in two
-- seconds by Facebook's own crawlers, before any person has seen it. Those
-- were counted as opens. The redirect now names the family of whatever
-- asked (a phone browser, a known crawler, a script) so a crawler is not an
-- open and an audit can tell the two apart afterwards.
alter table outreach_clicks add column if not exists agent text;
