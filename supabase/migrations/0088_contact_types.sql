-- Not everybody in the contact book is a client.
--
-- There has only ever been one shelf for a person, and twenty-eight places in
-- the app read a row on it as "a client of ours". That was fine while the only
-- way in was somebody booking an evaluation. It stops being fine the moment a
-- CRM export arrives carrying the stone yard, the tree crew and the realtor
-- who sends work — because they would land in every client picker, every count
-- of our clients, and on the coverage map as somebody we have already sold to.
--
-- So a contact gets a type, and everything that means "our clients" says so
-- explicitly rather than by assuming.

alter table customers add column if not exists contact_type text not null default 'client'
  check (contact_type in ('client', 'lead', 'supplier', 'subcontractor', 'referral_partner', 'other'));

-- Where the row came from, so a bad import can be found and undone whole. The
-- same reasoning as source_batch on the prospect list.
alter table customers add column if not exists source text;
alter table customers add column if not exists import_batch text;

-- The CRM's own id. Re-importing the same export updates rather than
-- duplicating, which matters because nobody imports a contact database once.
alter table customers add column if not exists external_id text;

create unique index if not exists customers_external_id_idx
  on customers(organization_id, external_id)
  where external_id is not null;

-- Kept because losing it is the one mistake that cannot be walked back: a
-- person who opted out of being contacted, contacted again.
alter table customers add column if not exists do_not_contact boolean not null default false;

-- How the CRM organised them. Free-form and preserved as-is, because a tag is
-- somebody's own filing system and re-interpreting it loses information.
alter table customers add column if not exists tags text[];

-- The address as it arrived, before anybody geocoded it.
--
-- A property row needs coordinates, and a CRM address is often partial ("Bel
-- Air, MD") or missing. Rather than making properties.lat nullable and
-- rippling that through every screen that draws a map, the raw text is parked
-- here and a property is created only once it resolves to a real point.
alter table customers add column if not exists import_address text;

create index if not exists customers_contact_type_idx on customers(organization_id, contact_type);

comment on column customers.contact_type is
  'client and lead are people who might buy. supplier, subcontractor and referral_partner are the trade. other is undecided — kept out of client lists until somebody says.';

notify pgrst, 'reload schema';
