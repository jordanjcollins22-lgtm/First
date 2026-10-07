-- One booking, made once.
--
-- A booking is checked for ("do we have this appointment already?") and then
-- made. Two deliveries of the same booking at the same moment -- GoHighLevel
-- sending one appointment twice, or a booking form submitted twice -- both
-- passed the check before either had written anything, and the client was
-- booked twice: two clients, two addresses, two jobs, a tenth of a second
-- apart.
--
-- A claim is taken before anything is made. Its key is the booking's own
-- name (the GoHighLevel appointment, or who and when on the booking page),
-- so the second delivery cannot take it, waits for the first to finish, and
-- answers with the same job.

create table if not exists public.booking_claims (
  key text primary key,
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Written and read by the server only.
alter table public.booking_claims enable row level security;

-- And the backstop: one job per GoHighLevel appointment, whatever path made it.
create unique index if not exists jobs_ghl_appointment_unique on public.jobs (ghl_appointment_id) where ghl_appointment_id is not null;
