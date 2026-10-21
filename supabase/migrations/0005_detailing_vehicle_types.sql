-- The funnel now starts by picking what we're detailing, including boats,
-- RVs and motorcycles. Boats and RVs are quoted, so monthly_price stays null.
alter table detailing_leads drop constraint if exists detailing_leads_vehicle_size_check;
alter table detailing_leads
  add constraint detailing_leads_vehicle_size_check
  check (vehicle_size in ('sedan', 'suv', 'truck', 'motorcycle', 'boat', 'rv'));
