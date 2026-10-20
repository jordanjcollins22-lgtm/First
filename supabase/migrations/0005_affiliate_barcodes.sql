-- Affiliate barcodes: every team member gets a permanent referral code. Store
-- items can print a QR code for the buyer's referral link (/r/<code>), and
-- each scan is logged before redirecting to the landing page.

create or replace function generate_affiliate_code() returns text
language plpgsql as $$
declare
  -- No 0/O, 1/I/L, so codes are easy to read off a truck.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
begin
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

alter table team_members add column if not exists affiliate_code text;
update team_members set affiliate_code = generate_affiliate_code() where affiliate_code is null;
alter table team_members alter column affiliate_code set default generate_affiliate_code();
alter table team_members alter column affiliate_code set not null;
create unique index if not exists team_members_affiliate_code_idx on team_members (affiliate_code);

-- 'affiliate': barcode is the buyer's referral link (always a QR code).
-- 'custom': the person ordering types the barcode value.
alter table merch_products add column if not exists barcode_source text not null default 'custom'
  check (barcode_source in ('affiliate', 'custom'));

create table if not exists affiliate_scans (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid references team_members(id) on delete set null,
  affiliate_code text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_scans_member_idx on affiliate_scans (team_member_id, created_at desc);

alter table affiliate_scans enable row level security;
-- Scans are written by the public /r/<code> route with the service-role key.
drop policy if exists "authenticated_full_access" on affiliate_scans;
create policy "authenticated_full_access" on affiliate_scans for all to authenticated using (true) with check (true);
