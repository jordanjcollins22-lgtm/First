-- Which account manager owns this client relationship — assigned per
-- customer (not per job/property), since one AM typically manages
-- everything for a given client. Used to route inbound calls straight to
-- the right person.

alter table customers add column if not exists account_manager_id uuid references profiles(id);
