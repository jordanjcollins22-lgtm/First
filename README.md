# Field Estimator

Field estimating & job-execution app: turn a property map into the operating
interface for estimating, scoping, pricing, and executing landscaping/property-
service jobs.

## Core workflow

Address → satellite map loads → draw work areas (polygon/rectangle/line/point)
→ assign a service template → measurements auto-calculate (Turf.js, geodesic)
→ attach photos → auto-cluster into zones → generate a work sequence →
auto-generated scope of work per area → crew step-through preview.

## Setup

You need two things before the app is usable past the landing page:

1. **Supabase project** — create one at [supabase.com](https://supabase.com),
   then run the SQL in `supabase/migrations/` (in order) against it via the
   SQL editor or `supabase db push`, followed by `supabase/seed/0001_service_templates.sql`
   to seed the starter service templates (Mulch Renovation, Weed Removal,
   Soft Wash House, Pressure Wash Concrete).
2. **Mapbox access token** — create one at
   [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/).

Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
```

Then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The landing page will
tell you if either credential is still missing.

Auth is intentionally minimal for this internal MVP tool (Supabase Auth,
unstyled) — RLS policies currently allow any authenticated user full access.

## Team check-ins (SMS via GoHighLevel)

Scheduled text check-ins with crew members so delays surface early.

**How it works**

1. On **/team**, add each person with their mobile number. The number is
   their identity: the app creates or links a GoHighLevel contact tagged
   `team-member`.
2. Give each person one or more scheduled check-ins, for example "Weekdays
   at 8:00 AM, reply within 30 min". A check-in can optionally be tied to a
   job, and the message supports `{name}` and `{job}`.
3. A cron job (`/api/cron/check-ins`, every 5 min) sends due check-ins
   through GHL. It also marks unanswered ones as **missed** and texts every
   team member flagged as a manager.
4. Replies hit `/api/ghl/inbound`. The app finds the person by GHL contact
   id or phone number and attaches the reply to their latest open check-in,
   marking it on time or late. Claude then reads the reply. Replies that
   report a delay or blocker get texted to managers.
5. **/check-ins** shows the whole history with statuses and Claude's
   one-line summaries.

**Setup**

1. Run `supabase/migrations/0003_team_check_ins.sql`.
2. Set these env vars (see `.env.example`):
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GHL_API_KEY`: a Private Integration token with contacts and
     conversation-message write scopes.
   - `GHL_LOCATION_ID`
   - `GHL_WEBHOOK_SECRET`
   - `CRON_SECRET`
   - `ANTHROPIC_API_KEY`: optional. Without it, replies are still recorded
     but not assessed.
3. In GoHighLevel, create a workflow with the trigger **Customer Replied**
   (channel: SMS) and filter it to contacts with the tag `team-member`. Add a
   **Webhook** action that POSTs to
   `https://<your-app>/api/ghl/inbound?secret=<GHL_WEBHOOK_SECRET>`.
4. In your existing client-messaging workflows, add a filter that excludes
   the `team-member` tag, so crew replies don't get client auto-responses.
5. `vercel.json` schedules the cron every 5 minutes, which requires Vercel
   Pro. On Hobby (daily crons only), point any external scheduler at the
   endpoint instead, for example Supabase `pg_cron` + `pg_net` or
   cron-job.org. Send the header `Authorization: Bearer <CRON_SECRET>`.

## Communications agent (email, text, social, all through GoHighLevel)

One AI assistant (Claude) handles every message that comes in. GoHighLevel
already brings texts, email, Facebook and Instagram DMs, WhatsApp, Google
Business messages and web chat into one Conversations inbox, so GHL forwards
each one to `/api/ghl/inbound` and the agent decides what to do.

**Who it talks to, and what it can do**

| Sender | How it's recognized | What the agent can do |
| --- | --- | --- |
| Employee | phone / GHL contact on **/team** | answer questions, list jobs, text them a no-login job link, read their check-ins, escalate to managers |
| Manager | team member marked as manager | everything above for anyone, plus text any employee, approve, edit or discard customer replies ("send a1b2c3"), ask "what happened today?" |
| Customer | matches a customer or detailing lead | write a reply; by default it waits for approval |
| Unknown | anything else | same as customer |

Customer replies are held for approval unless `AGENT_CUSTOMER_MODE=auto`.
When one is held, managers get a text with the draft and can reply
"send <id>" or say what to change. The same drafts appear on **/inbox**, with
a log of everything the agent did. If the agent errors or won't handle a
message, managers get the original message so nothing is dropped.

**No logins for employees.** Employees never sign in. When they need to see
a job, the agent texts them a link like `https://<app>/e/<token>`. The link
opens just that job's crew plan, expires after 72 hours, and only a hash of
the token is stored.

**What the agent knows about the business** lives in
`src/lib/agent/business-profile.ts`. Add hours, service areas, policies and
FAQs there. It won't make up prices or times that aren't in that file or the
app's data.

**Setup**

1. Run `supabase/migrations/0006_comms_agent.sql`.
2. Set `ANTHROPIC_API_KEY`, and optionally `AGENT_CUSTOMER_MODE` and `APP_URL`
   (see `.env.example`).
3. In GoHighLevel, edit the **Customer Replied** workflow from the check-ins
   setup: remove the `team-member` tag filter and set the channel to all
   channels. In the Webhook action, add Custom Data `channel` = the message
   type merge field, so replies go back on the same channel.
4. Turn off GHL auto-replies that would now double up with the agent.
5. Mark at least one person as a manager on **/team** so escalations have
   somewhere to go.

## Architecture notes

- **Single source of truth for measurements**: `src/lib/measurement.ts` is
  the only place area/length/perimeter math happens (Turf.js, geodesic). The
  map UI, scope generation, and (future) pricing engine all call it — never
  re-derive measurements elsewhere. Verified against known real-world
  reference shapes in `src/lib/measurement.test.ts`.
- **Geometry locking**: once a WorkArea is "locked" (simulating a price sent
  to a customer, via the Lock button), further geometry edits are versioned
  into `work_area_geometry_versions` instead of silently overwritten — see
  `updateWorkAreaGeometry` in `src/lib/actions/work-area-actions.ts`.
- **Shape cleanup**: `src/lib/geometry-cleanup.ts` simplifies/closes traces
  and refuses to auto-apply if the resulting area shifts more than ~2%,
  surfacing a before/after confirmation instead.
- **Service templates are data-driven**: nothing about a specific service is
  hardcoded in the UI. Add/edit templates at `/admin/service-templates`; the
  map's "assign service" dialog and the crew checklist both just read
  whatever's active in the `service_templates` table.
- **Zones & sequencing** (`src/lib/zone-clustering.ts`,
  `src/lib/sequencing.ts`) are simple, deterministic v1 algorithms
  (single-linkage proximity clustering; nearest-neighbor route) — always
  presented as an editable recommendation, not a black box.

Run `npm test` to run the geometry/measurement test suite.

## Tech stack

Next.js (App Router) + TypeScript + Tailwind + shadcn-style components,
Supabase (Postgres + Storage + Auth), Mapbox GL JS + Mapbox GL Draw, Turf.js.
