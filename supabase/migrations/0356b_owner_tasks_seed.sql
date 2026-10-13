-- The owner's task list, seeded with the 33 items the v2 Task list showed
-- (src/components/v2/v2-shell.tsx TASKS), for every business that has none
-- of them yet. Same words, same statuses. src/lib/owner-tasks.ts holds the
-- list, and its test checks this file against it.
--
-- Additive and idempotent: a task already there (same section and title)
-- is left exactly as somebody last set it.
insert into public.owner_tasks (organization_id, section, title, status, note, position)
select o.id, v.section, v.title, v.status, v.note, v.position
from public.organizations o
cross join (values
  ('Marketing', 'Google Ads', 'not_built', 'No account connected. Bookings already record ad click IDs.', 1),
  ('Marketing', 'Website', 'partly_built', 'Website editor and live previews are here. Still to do: point the business''s own domain at /site, and add photos and reviews to it.', 2),
  ('Marketing', 'Door hangers & mail', 'partly_built', 'Numbers are here. Planning a run or a mailing is still only in the current app.', 3),
  ('Marketing', 'Lead lists', 'partly_built', 'Counts are here. Importing and working a list is still only in the current app.', 4),
  ('Marketing', 'Email campaigns', 'partly_built', 'Campaigns are listed. Writing and starting one is still only in the current app.', 5),
  ('Marketing', 'Property managers', 'partly_built', 'Numbers are here. Approving the emails is still only in the current app.', 6),
  ('Marketing', 'Local groups', 'partly_built', 'Groups are listed. Group rules and paid posts are still only in the current app.', 7),
  ('Marketing', 'What worked', 'partly_built', 'Revenue by channel is here.', 8),
  ('Marketing', 'SEO', 'partly_built', 'Reviews work. Keyword tracker is empty; Business Profile stats not connected.', 9),
  ('Marketing', 'Social media › Facebook & Nextdoor', 'partly_built', 'Tracked links work. Scheduled posts aren''t publishing on their date.', 10),
  ('Marketing', 'Social media › Instagram, Google Business posts, TikTok, YouTube', 'not_built', 'Nothing on these channels yet.', 11),
  ('Marketing', 'Affiliates', 'partly_built', 'Codes and links work. Commission payouts never recorded; rates on file aren''t 4%.', 12),
  ('Marketing', 'Affiliate-only view', 'not_built', 'An affiliate signing in should land on the comment responder only.', 13),
  ('Sales', 'Evaluation booking', 'partly_built', 'Booking and availability work. Routing by area and workload not built.', 14),
  ('Sales', 'Proposals › Pricing formulas', 'partly_built', 'Most active services have no rate set.', 15),
  ('Sales', 'Automated follow-up', 'partly_built', 'Proposal and invoice follow-ups work. No-show rebook and seasonal re-engage not built.', 16),
  ('Sales', 'My evaluations (evaluator view)', 'partly_built', 'The evaluator''s visit screens exist; no evaluator-only home in the new layout.', 17),
  ('Sales', 'Evaluators', 'partly_built', 'Roster and pay are on profiles. No performance view.', 18),
  ('Operations', 'Scheduling', 'partly_built', 'Work days exist. Auto-placement and weather reschedule not built; past work days don''t close.', 19),
  ('Operations', 'Materials & ordering', 'partly_built', 'Materials and suppliers work. Purchase orders and delivery tracking not built.', 20),
  ('Operations', 'Completion & close-out', 'partly_built', 'Walkthroughs and reviews work. Job costing is rarely filled in.', 21),
  ('Operations', 'My projects (project lead view)', 'not_built', 'No project leads yet and no lead-only home.', 22),
  ('Operations', 'My day (project tech view)', 'partly_built', 'My Day and crew check-ins exist; no tech-only home in the new layout.', 23),
  ('Operations', 'Project team', 'partly_built', 'Roster and pay exist. Performance view not built.', 24),
  ('Admin', 'Departments', 'partly_built', 'Alerts are computed here; goals per department not built.', 25),
  ('Admin', 'Customer accounts', 'partly_built', 'Contacts and messages exist. One timeline per customer not built.', 26),
  ('Admin', 'Users & permissions', 'partly_built', 'Map the old roles onto the new ones and per-tab access.', 27),
  ('Admin', 'Integrations', 'partly_built', 'GoHighLevel, Stripe, email and banks work. Google Ads not connected.', 28),
  ('Admin', 'Company & compliance', 'partly_built', 'Locations and designs exist. Insurance, licenses, contracts and legal wording not built.', 29),
  ('Admin', 'Settings', 'partly_built', 'Services list exists (with duplicates). Service area and notification settings need a screen.', 30),
  ('Admin', 'Account managers', 'partly_built', 'Role exists. Assignments and oversight not built.', 31),
  ('Admin', 'Hiring (account managers)', 'not_built', 'The hiring flow covers project tech and project lead only.', 32),
  ('Admin', 'Switch the main address to the new layout', 'not_built', 'Last step, once everything above is done.', 33)
) as v(section, title, status, note, position)
on conflict (organization_id, section, title) do nothing;
