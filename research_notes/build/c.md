# Workstream C: sales pipeline automation — manifest

(Written in the worktree because this agent cannot write to the shared checkout. Copy it to `/home/user/First/research_notes/build/c.md`. It is also force-committed on `build/c` as `research_notes/build/c.md`.)

## 1. Branch and commits

Branch `build/c` (local, not pushed), in worktree `/home/user/First/.claude/worktrees/agent-a89886ae2cebd2cfe`.

- `954bbb20` Sales autopilot: price guardrails, speed to proposal, MHIC deposits, territory routing
- `c48ec9a0` Sales panels: pipeline autopilot, evaluator scorecard, territories
- A third commit adds this manifest.

## 2. Panels

| Export | File | v2 page › choice |
|---|---|---|
| `PipelineAutopilotPanel` | `src/components/v2/panels/pipeline-autopilot.tsx` | Sales › Pipeline |
| `EvaluatorScorecardPanel` | `src/components/v2/panels/evaluator-scorecard.tsx` | Sales › Evaluations |
| `TerritoriesPanel` | `src/components/v2/panels/territories.tsx` | Sales › Evaluations (below the scorecard) |

The client parts and shared bits are in `src/components/v2/panels/sales/`: `sales-ui.tsx` (needs-you strip, KPI tile), `pipeline-autopilot-controls.tsx`, `territories-editor.tsx`, `territory-map.tsx`. That subfolder holds no panels, so a glob over `panels/*.tsx` only picks up the three above.

Each panel starts with a needs-you strip (empty when there is nothing), then KPIs against target, then the automation's status and settings:

- **Pipeline.** The strip lists prices the guardrails held, with the reason and Check again / Offer Good-Better-Best / Dismiss buttons; proposals past the speed target; and a count of proposals from before go-live that still need approval. The KPIs are lead response, booked rate, show rate, speed to proposal, close rate, average ticket, pipeline value and overdue now, each against the report's planning band, with the band's source in small print. Below them sit the autopilot's activity this week, its settings form, and rate coverage: every active service with no rate, editable in place, plus duplicate groups with a confirm-then-merge button.
- **Scorecard.** The strip lists overdue proposals with the evaluator's name. Team tiles come next. Then one card per evaluator: visits, show rate, proposals sent, speed to proposal (median and share within target), close rate (coloured against the 45–55% band; the target is 55%, the business is at 45% now), average ticket, revenue sold, and commission earned (the evaluator's 4% pool share of what has been collected on their accepted jobs).
- **Territories.** The strip shows "migration not applied" and any evaluator with fewer than half their bookings inside their territory. Tiles show how routing is going. The editor lets you pick an evaluator and type zip codes or draw polygons (Mapbox Draw), with their last 90 days of evaluations shown as dots and other evaluators' areas shown faintly.

## 3. Migrations

`supabase/migrations/0361_sales_autopilot.sql`. It is additive and has not been applied. It does the following:

- `sales_autopilot_settings`: one row per org. It holds the switches, margin targets per division, the formula tolerance, the speed target, overdue exceptions, Good/Better/Best and the MHIC licence number, plus `started_at` and `overdue_started_at`, which mark go-live. RLS is org-scoped.
- `proposal_guardrail_checks`: one row per draft (`unique(job_id, generated_at)`). It records whether the draft passed, the reasons, the margin and deviation, and the action taken (ignore, hold, approve, approve_and_send), plus `sent_at`. RLS is org-scoped.
- `sales_exceptions`: kinds `proposal_overdue` (assigned to the evaluator) and `price_held` (to the office). There is one row per `(organization_id, dedupe_key)` and a state of open, resolved or dismissed. RLS is org-scoped. I kept these separate from `job_exceptions` on purpose: that table's 13 crew kinds sit behind a CHECK constraint. The coordinator can fold them into the unified queue.
- `evaluator_territories`: zips `text[]` and areas jsonb (rings of `[lng, lat]`), unique per evaluator. RLS is org-scoped.
- `services`: adds `merged_into` and `merged_at`, and **widens** `services_status_check` to also allow `'merged'`. This drops and re-adds the constraint, but it is looser than before and changes no rows. Please review it, because the brief says "no drops".
- `merge_services(p_from, p_into)`: a plpgsql function, security invoker, using `current_org_id()`. In one transaction it re-points `job_requested_services`, `service_tools`, `service_materials`, `custom_field_options`, `canvas_designs.zones[].service.typeId` and `jobs.evaluation_plan[].typeId`. It copies the rate, timing and wording across when the kept service has none, then marks the old service `merged`. It deletes no rows: a reference that would duplicate one the kept service already has stays where it is, and the merged row stays so old proposals still read. Execute is granted to `authenticated`.

`src/lib/migrations/bundle.ts` stops at 0146, so it didn't need regenerating.

## 4. Cron routes

- `GET /api/cron/proposal-autopilot`, run **every 15 minutes** from pg_cron and guarded by `authorizeCron`. For every org it:
  1. checks drafts waiting on approval (evaluation submitted after go-live) and approves or sends those inside the guardrails, re-checking a held one at most hourly;
  2. retries sends held by quiet hours, and reconciles sends approved later on My Day (writes `job_proposals.sent_at`);
  3. opens a `proposal_overdue` exception for each overdue proposal and texts the evaluator once (`notifyTeamMember`, kind `proposal_responses`);
  4. closes exceptions that have been dealt with.

The autopilot also runs straight after an evaluation is submitted, via `after()` in `updateEvaluationStatus` (`src/lib/actions/job-actions.ts`), so a proposal inside the guardrails goes out within seconds.

## 5. Public (no-login) routes

None are new. These existing public pages changed: `/proposal/[token]` (now shows the MHIC contract block for home-improvement scopes) and `/proposal/[token]/pay` (shows the deposit amount, at most a third, for home-improvement scopes).

## 6. Integration providers, keys and env vars

- No new providers.
- Existing env vars that are used: `CRON_SECRET` for the cron, Stripe for deposits, Resend for the proposal email (it goes through `sendClientMessage`), and `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` for drawing territories. Without the Mapbox token the map shows "Not connected — add it in Settings › Integrations" and zip codes still work.
- The owner must enter the **MHIC licence number** in the Pipeline panel's settings (from their MHIC licence, or labor.maryland.gov/license/mhic). Until then the contract block says "MHIC licence number to be added before signing".

## 7. Settings and defaults (`sales_autopilot_settings`)

| Setting | Default |
|---|---|
| `auto_approve` (approve prices inside the guardrails) | on |
| `auto_send` (and email them) | on (needs `auto_approve`) |
| `started_at` (go-live) | written the first time the cron or a submit reads the settings; only evaluations submitted after it are touched |
| margin targets | maintenance 50%, install 30%, snow 25%, irrigation 45% |
| `formula_tolerance` | ±15% |
| `speed_target_hours` | 2 |
| `overdue_exceptions` / `overdue_started_at` | on / go-live at the first run |
| `offer_options` (Good/Better/Best on autopilot sends) | off |
| `mhic_license` | empty |

The guardrails are in `src/lib/sales/price-guardrails.ts`. A proposal passes only when all of these hold:

1. Every area's service has a rate on the rate card (`services.cost`, the same "with a rate" measure v2 already reports), and every forward-pricing line has a production rate and a quantity.
2. Margin is at or above the target for the division carrying the most of the price. Margin = (price − labour, travel and materials − the 15% commission pool and reserve) ÷ price.
3. The price is within ±15% of the forward-pricing formula.

These also hold a proposal: wording still to approve, the evaluation still going, a $0 price, salting (it is priced by the salt rules), or a site map that no longer matches the draft. Every hold is shown with its reason.

## 8. Requested edits to shared files

- `src/lib/data/v2.ts` / `v2-shell.tsx`: place the three panels as in section 2. Then the v2 task-list notes can be updated: "Routing by area and workload not built" (now built, including GHL), "Most active services have no rate set" (rate coverage), "No performance view" for evaluators (scorecard), and "Services list exists (with duplicates)" (merge).
- `vercel.json`: nothing. Wire `/api/cron/proposal-autopilot` into pg_cron every 15 minutes, as `pm-outreach` is.
- `database.types.ts`: add the four new tables, `services.merged_into` and `merged_at`, and the `merge_services` RPC. The code casts to `SupabaseClient` until then.

Non-shared files this branch edits, so merges should watch for them:

- `src/lib/evaluator-choice.ts` (optional `territories` parameter, backwards-compatible)
- `src/lib/actions/public-booking-actions.ts`
- `src/lib/ghl/inbound.ts` (GHL bookings are now routed; before, the job was assigned only when there was exactly one evaluator)
- `src/lib/actions/job-actions.ts`
- `src/lib/actions/public-proposal-actions.ts`
- `src/lib/proposal-checkout.ts`
- `src/lib/actions/stripe-settlement.ts` (a deposit no longer sets `job_proposals.paid_at`)
- `src/components/proposal/proposal-view.tsx`
- `src/app/proposal/[token]/page.tsx` and `pay/page.tsx`

## 9. Verification, unfinished work and risks

**Verified.**

- `npx tsc --noEmit -p .` is clean.
- `npx eslint` on every file I touched is clean.
- The full suite passes: `npx vitest run` gives 372 files and 5,870 tests. That includes the new tests in `src/lib/sales/*.test.ts` (guardrails, divisions, autopilot decision and go-live, speed to proposal, MHIC classification, deposit cap and contract wording, territories and routing with `chooseEvaluator`, scorecard, KPIs, duplicate detection and merge rules, Good/Better/Best), plus `rls-coverage`, `server-actions` and the existing `evaluator-choice` tests.
- I have not applied the migration or run anything against a database, and I have not opened any panel in a browser.

**Not finished.**

- **Good/Better/Best.** Before this branch, options (0349) could be shown and accepted but nothing in the app created them. I added `buildGoodBetterBest` (`src/lib/sales/good-better-best.ts`), which builds three options from the priced lines:
  - Good: the essentials only, with finishing work removed.
  - Better: the price as quoted, marked recommended.
  - Best: Better plus a weed-preventer line priced from the production rates.

  It is offered from a held proposal's button, or automatically when `offer_options` is on. The Best add-on is my design choice and should be confirmed with the owner.
- **The rest of a home-improvement job.** For home-improvement scopes the signing invoice, checkout, PaymentIntent and offline (cash/cheque) amounts are capped at one-third, and the deposit is flagged so Stripe settlement does not mark the proposal paid in full. **No automation bills the remaining two-thirds** as the work is done; the office raises it the way it does today. The Stripe invoice line description at signing still reads "Landscaping services".
- **The MHIC block covers every customer.** It does not tell residential from commercial; the rule only applies to residential.
- **Speed is measured in wall-clock hours,** as the NALP claim is stated. An evaluation submitted at 7 pm will be overdue by 9 pm.

**Risks.**

1. While `require_email_approval = true`, an autopilot send is parked on My Day by `sendClientMessage`. The proposal is approved and its link is live, but it isn't emailed until the owner approves. The cron picks up the sent date afterwards. The 2-hour target is only reachable once workstream A1's per-kind policy lets `proposal_ready` go out automatically.
2. Both switches default to on. Go-live is written at the first cron run or the first submit after deploy, and the earlier backlog is never touched; it appears as a needs-you count instead.
3. `MHIC_PHONE` (410-230-6001) comes from the research notes, which cite Montgomery County. Check it, and the whole contract wording, against labor.maryland.gov before relying on it. The block has no arbitration or lien clause and says so.
4. Guardrail checks call `travelForProperty`, which uses Mapbox drive times. That adds up to 4 calls per check, and held proposals are re-checked hourly.
5. GHL routing assigns the evaluator in the app but does not push that assignee back to GoHighLevel.
6. Lead response time is measured from client creation to the first logged client message, so self-booked leads count their automatic confirmation. It is directional.
