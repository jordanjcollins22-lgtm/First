-- Who actually turns up for a service.
--
-- Not all of it is our own crew. Some work goes to a local business we
-- partner with, and a client is entitled to know which before they agree to
-- let anybody onto their property. The proposal answered "who will be at my
-- property?" with a flat "our own crew, not subcontractors", which is true of
-- most of the work and a lie about the rest.
--
-- Set per service, because that is the level at which it is actually true: we
-- do the mulch and the mowing, somebody else does the tree work.

alter table services add column if not exists performed_by text not null default 'own'
  check (performed_by in ('own', 'partner'));

comment on column services.performed_by is
  'Whether our own crew does this service or a partner business does. Decides what a client is told about who will be on their property.';

-- The partner's trading name, which is the name the client will see on a
-- truck in their driveway and should therefore be the name on the proposal.
alter table services add column if not exists partner_name text;

comment on column services.partner_name is
  'The partner business as the client would see it on their truck. Only meaningful when performed_by is partner.';

notify pgrst, 'reload schema';
