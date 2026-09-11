@AGENTS.md

# Winter Pass funnel — operating manual for Claude Code

This repo holds the self-optimizing sales funnel for a Harford County, MD
landscaping company's winter de-icing membership (the "Winter Pass"). Read
this file first in every session. It is the durable memory of the system.

## What we sell (never changes without the owner)

- **Salt Pre-Book** (core): pre-paid, automatically dispatched calcium chloride
  de-icing for the season. Customer does nothing after checkout.
- **Pet-Friendly De-Icer** (add-on): pet-safe formulation, priced as an upgrade.
- **Winter Schedule Hold**: reserved slot on the plow/clearing route. Capacity
  is real and limited; the count on the page is always read live from
  `slot_inventory`.
- Positioning, non-negotiable: **"Sit back and relax. Winter is handled."**

All product claims come from `PRODUCT_FACTS.md`. Nothing else may be claimed.

## Hard constraints (memorize)

1. **Legal text is frozen.** Lives only in `legal/*.md`, hashed into
   `legal/HASHES.lock`. Change it only via the `LEGAL:` commit flow
   (`legal/README.md`). Never inline legal copy in components. Every order
   stores the hashes the customer accepted, with timestamp and IP. Refund
   policy, service agreement, and SMS consent need visible checkboxes before
   payment. No automated process ever writes to `legal/`.
2. **The offer is dynamic; the promise is not.** The offer engine may change
   prices (within `offer-config.yaml` floor/ceiling), discount depth, bundles,
   highlighted tier, headline/subhead variants from the bank, honest urgency
   copy, payment-plan options, add-on pricing. It may not change what the
   products are, the guarantee terms, anything in `legal/`, or any claim not
   in `PRODUCT_FACTS.md`. A customer always pays the price they were shown;
   variants are pinned to the session.
3. **Zero effort for the customer** after checkout. All follow-up runs through
   GoHighLevel workflows triggered by webhooks.

## Where things live

| Thing | Path |
| --- | --- |
| Assumptions log (override anything here) | `DECISIONS.md` |
| Allowed product claims | `PRODUCT_FACTS.md` |
| Price bounds (owner-only) | `offer-config.yaml` |
| Experiments and arms | `experiments.yaml` |
| Frozen legal text + lock | `legal/` |
| Legal enforcement | `scripts/legal-hash.mjs`, `scripts/legal-guard.sh`, `.githooks/`, `.github/workflows/ci.yml` |
| Weekly reports | `reports/YYYY-MM-DD.md` |
| Operations manual | `RUNBOOK.md` (written in step 8) |
| App | `src/app/` (Next.js App Router), `src/lib/` |
| Database | `supabase/migrations/0003_winter_pass.sql`, `docs/SCHEMA.md`, smoke test `npm run db:smoke` |

## Tech stack

Next.js 16 App Router + TypeScript + Tailwind 4 on Vercel. Supabase Postgres
for orders, sessions, events, experiments, assignments, slot inventory, legal
acceptances. Stripe Checkout (one-time and subscription). GoHighLevel API for
contacts, opportunities, tags, workflows. First-party events in Supabase (the
optimizer never depends on GA4). Google Ads enhanced conversions. NWS weather
API (OpenWeather fallback). Vercel cron + Supabase edge functions.

Before writing any Next.js code, read the relevant guide in
`node_modules/next/dist/docs/` (this Next version differs from training data).

## The optimization loop

- Events (first-party, `events` table): page_view, scroll_50, scroll_90,
  cta_click, plan_view, plan_select, checkout_start, address_valid,
  address_out_of_area, legal_accepted, payment_start, purchase, lead_captured,
  sms_consent. Each carries variant assignments, UTMs, device, referrer, zip.
- Bandit: Thompson sampling per experiment, objective **revenue per visitor**.
  Minimum 200 sessions or 15 purchases per arm before traffic shifts. Never
  kill an arm; 5% exploration floor. Config in `experiments.yaml#bandit`.
- Weekly job (Vercel cron, Monday 06:00 ET): pull 7- and 28-day events, update
  posteriors, re-weight, write `reports/YYYY-MM-DD.md`, text the owner via
  GoHighLevel, auto-apply proposals that touch only allowed fields, queue the
  rest for an "approve" reply. Every auto-applied change is logged with
  before/after and is revertible from `/admin` in one click.
- Guardrails: purchases down >30% week-over-week on flat traffic → auto-revert
  to last known best + text owner. Checkout error rate >2% → pause experiments
  + text owner. Compare week-over-week and year-over-year; never a September
  week against a December week.

## How to run the weekly review (when the owner says "run the weekly review" or "improve the funnel")

1. Read this file, `DECISIONS.md`, `PRODUCT_FACTS.md`, `offer-config.yaml`,
   `experiments.yaml`, and the newest file in `reports/`.
2. Pull admin data: conversion and revenue per arm, slot inventory, guardrail
   status, error rate, and any pending proposals (from the `/admin` API or
   directly from Supabase).
3. Propose changes **only** within the guardrails above. Copy proposals must
   match the voice below and cite `PRODUCT_FACTS.md`. Price proposals must
   sit inside `offer-config.yaml` bounds. Never touch `legal/`.
4. Write the proposals into the report, apply the auto-appliable ones through
   the offer engine's apply API (never by hand-editing state), and list the
   rest for the owner.
5. If you learn something durable about what converts for this audience, add
   it to the "Learnings" section below and keep it short.

## Copy voice

Calm, competent, neighborly. A well-run local company, not a SaaS startup.
Short sentences. No exclamation points. Speak to the outcome: you wake up, the
driveway is safe, the dog's paws are fine, you never thought about it. Say
"calcium chloride" once with the plain-English reason (won't pit your
concrete or ruin your pavers), then "our de-icer." Primary CTA repeats 4+
times per page.

## Delivery status

| Step | Status |
| --- | --- |
| 1. Scaffold, CLAUDE.md, DECISIONS.md, PRODUCT_FACTS.md, legal + hash lock + CI, offer-config, experiments | done |
| 2. Supabase schema + migrations | done (`docs/SCHEMA.md`) — check-in |
| 3. Landing, plan picker, checkout, thank-you, waitlist | next |
| 4. Stripe, webhooks, GoHighLevel, SMS/email | pending |
| 5. Events, bandit, weekly cron, admin, kill switch | pending (check-in after) |
| 6. Google Ads conversions, UTM, per-ad-group variants | pending |
| 7. Deploy + end-to-end test purchase | pending |
| 8. RUNBOOK.md | pending |

## Learnings (append-only, dated)

_None yet. First entries will come from the first weekly report with real traffic._
