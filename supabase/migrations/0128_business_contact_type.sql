-- Local businesses we approach about the flyer.
--
-- They are not clients, leads, suppliers or subcontractors. They are the
-- other side of the advertising: somebody we ring to sell a tile to. Filing
-- them as "other" put them in the unsorted pile with everything nobody had
-- decided about, which is where a call list goes to die.

alter table customers drop constraint if exists customers_contact_type_check;

alter table customers add constraint customers_contact_type_check
  check (contact_type in (
    'client',
    'lead',
    'supplier',
    'subcontractor',
    'referral_partner',
    'business',
    'other'
  ));

comment on column customers.contact_type is
  'What kind of contact this is. business = a local business we approach about advertising on the flyer.';

notify pgrst, 'reload schema';
