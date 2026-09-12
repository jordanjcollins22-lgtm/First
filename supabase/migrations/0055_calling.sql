-- Click-to-call: a team member's own phone number, so outbound calls can
-- ring them first and then bridge to the client, and inbound calls can be
-- routed to the right person. Admin-settable from the Team page, same as
-- pay rate.

alter table profiles add column if not exists phone text;
