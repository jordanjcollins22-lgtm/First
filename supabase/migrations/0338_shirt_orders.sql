-- Company shirts, ordered from the app: what is needed (design, style,
-- colour, size, how many, and who for), then ordered from the printer and
-- received. The lines are kept as the order sheet shows them.
create table if not exists shirt_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- placed: needs ordering. ordered: sent to the printer. received: in hand.
  status text not null default 'placed' check (status in ('placed', 'ordered', 'received', 'cancelled')),
  -- [{ design, style, color, size, quantity, name }]
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  note text,
  -- Who it went to and anything they said: the print shop, a quote, an order number.
  printer_note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  ordered_at timestamptz,
  received_at timestamptz
);

comment on table shirt_orders is
  'Company shirts asked for in the app: the lines (design, style, colour, size, quantity, who for), then ordered from the printer and received.';

create index if not exists shirt_orders_org_idx on shirt_orders (organization_id, created_at desc);

alter table shirt_orders enable row level security;

drop policy if exists shirt_orders_own_org on shirt_orders;
create policy shirt_orders_own_org on shirt_orders
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
