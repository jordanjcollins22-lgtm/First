# PRODUCT_FACTS.md — the only claims anyone may make

Every sentence of marketing copy, every email, every SMS, and every optimizer
proposal must be traceable to a fact on this page. If it is not here, it is not
true and may not be said. The optimizer reads this file and rejects proposals
that introduce claims outside it. Items marked **UNVERIFIED** are the owner's
to confirm; copy must not lean on them until confirmed.

## Company

- Name: **JS Landscaping** (from the logo; DECISIONS D-27)
- Licensed and insured in Maryland.
- Local: serves Harford County, Maryland only.
- Contact: `[[PHONE]]` · `[[EMAIL]]` (unconfirmed)
- Logo: `public/brand/js-landscaping-logo.png`. Brand colors and type: DECISIONS D-28.

## Service area

Bel Air, Fallston, Forest Hill, Abingdon, Havre de Grace, Aberdeen,
Jarrettsville, Churchville, Darlington, Joppa, Edgewood.
Zip-code gate: see `src/config/service-area.ts` (provisional list, DECISIONS D-08).

## Product 1 — Salt Pre-Book (core, in every Winter Pass)

- Customer pre-pays before the season for de-icing applications all winter.
- Material: **calcium chloride** based de-icer, not rock salt (sodium chloride).
  - Works at lower temperatures than rock salt.
  - Gentler on concrete (won't pit it), pavers (won't corrode them), and lawn
    edges (won't burn them) at label rates.
- Dispatch is **automatic**: we monitor the forecast and apply before and/or
  after ice and snow events. Trigger: forecast calls for ice, or
  `[[SNOW_INCHES_TRIGGER]]`+ inches of snow (provisional: 1 inch).
- No calls. No scheduling. No per-storm invoices.
- Customer does not need to be home.
- Alerts: text (and email) when a crew is on the way and when the job is done,
  with a photo where practical.
- Coverage: paved driveway, walkways, and front steps as measured at checkout.
- No cap on qualifying visits within the season.

## Add-on — Pet-Friendly De-Icer

- Pet-safe formulation substituted for the standard product at that property
  for every application.
- Speaks to: paws (no burning/irritation from standard salts), ingestion when
  pets lick paws, and tracking residue into the house.
- Priced as an upgrade to Salt Pre-Book. Included in the "Salt + Pet-Safe" and
  optional in the "Full Winter Pass" plans.
- **UNVERIFIED**: exact product name/brand and whether it is also calcium
  chloride based. Copy says "pet-safe de-icer" only until confirmed.

## Product 2 — Winter Schedule Hold

- Reserves a place on our plow/clearing route for the entire season.
- Capacity is genuinely limited: `[[NUMBER OF ROUTE SLOTS]]` (provisional 40).
- Remaining slots shown on the site are read live from the `slot_inventory`
  table. **A fake or rounded counter is forbidden.**
- **UNVERIFIED**: whether per-event plowing is included in the hold price or
  billed per event. Copy must not promise "unlimited plowing" until confirmed.

## Pricing model

- Pay in full (visible discount) or monthly October through March.
- The price a customer is shown is the price they pay.
- Price floors/ceilings: `offer-config.yaml` (owner-only).

## Guarantee

- Name: `[[GUARANTEE NAME]]` (unconfirmed).
- Shape: if the first application of the season doesn't meet expectations,
  full refund. Exact terms live only in `legal/refund-policy.md`.
- The optimizer may change how prominently the guarantee is shown, never its
  terms.

## Season

- Service window target: November 15 – March 31 (provisional).
- Renewal offer goes out automatically the following August.

## Referral

- `$[[AMOUNT]]` credit (provisional $50) per referred neighbor who purchases.
- Neighbors on the same route are cheaper to serve; that is why we pay for it.

## Social proof (all UNVERIFIED — do not render until the owner supplies data)

- Google rating and review count.
- Number of homes protected last season.
- Testimonials (name, town, quote).
