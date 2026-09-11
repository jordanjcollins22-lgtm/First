-- Winter Pass seed: the current season's slot inventory and the optimizer singleton.
-- total_slots mirrors offer-config.yaml#schedule_hold_slots_total (provisional 40, DECISIONS D-09).
insert into slot_inventory (season, total_slots) values ('2026-27', 40)
on conflict (season) do nothing;

insert into optimizer_state (id, status) values (true, 'running')
on conflict (id) do nothing;

-- Experiments and arms are synced from experiments.yaml by `npm run experiments:sync` (step 5),
-- not seeded here, so the YAML stays the single source of truth for arm definitions.
