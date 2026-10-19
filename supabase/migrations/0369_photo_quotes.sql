-- Quoting small jobs from photos.
--
-- A client who books with a budget under the owner's line skips picking a
-- time: the job is made with no evaluation date and they go straight to the
-- pre-evaluation form, where they tap the areas they want work in on their
-- own lot, say what they want done in each, and add photos. The office
-- prices it from that, or sends them a link to book a visit after all.
--
-- 1. sales_autopilot_settings: the switch and the dollar line, beside the
--    rest of the pipeline's automatic settings. Off until the owner turns it
--    on, so nobody's booking changes the moment this is applied.
-- 2. evaluation_intakes: which forms are photo quotes, and what the office
--    decided about each one. The form is made by the app for these (the
--    trigger only makes one for a job with a date), and is otherwise the
--    same row the booked visits use.
--
-- Additive only.

-- 1 ------------------------------------------------------------------------
alter table public.sales_autopilot_settings
  add column if not exists photo_quotes boolean not null default false;
alter table public.sales_autopilot_settings
  add column if not exists photo_quote_line numeric not null default 1500
    check (photo_quote_line > 0 and photo_quote_line <= 1000000);

comment on column public.sales_autopilot_settings.photo_quotes is
  'Booking with a budget wholly under photo_quote_line skips the visit: the client sends areas and photos and is quoted from those.';
comment on column public.sales_autopilot_settings.photo_quote_line is
  'Dollars. A budget bracket whose top is at or under this is a photo quote; anything over, or "not sure", books a visit.';

-- 2 ------------------------------------------------------------------------
alter table public.evaluation_intakes
  add column if not exists photo_quote boolean not null default false;
alter table public.evaluation_intakes
  add column if not exists photo_quote_outcome text
    check (photo_quote_outcome in ('priced', 'visit'));
alter table public.evaluation_intakes
  add column if not exists photo_quote_outcome_at timestamptz;

comment on column public.evaluation_intakes.photo_quote is
  'Made for a booking under the photo-quote line: no visit was booked, and the form asks for areas on the map with photos of each.';
comment on column public.evaluation_intakes.photo_quote_outcome is
  'What the office did with a sent photo quote: priced it, or asked the client to book a visit. Null while it waits.';

create index if not exists evaluation_intakes_photo_quote_idx
  on public.evaluation_intakes (organization_id, submitted_at desc)
  where photo_quote;
