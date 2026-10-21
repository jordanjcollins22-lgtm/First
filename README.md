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

## Team store (truck magnets with affiliate QR codes)

Team members order custom items, mainly a truck door magnet whose QR code is
their own affiliate link. We don't make anything. We own the design, the app
builds a print-ready file per order, and an outside print vendor makes it and
ships it to the address on the order.

**Affiliate codes**

- Every team member gets a permanent 6-character affiliate code (shown on
  **/team** with their scan count).
- An affiliate item's QR code holds `APP_URL/r/<code>`. When someone scans
  it, the app logs the scan against that team member and redirects to
  `AFFILIATE_LANDING_URL?ref=<code>`. Your quote form or CRM can read `ref`
  to credit the sale.
- The QR code points at this app, not straight at the landing page. So you
  can change the landing page later without reprinting any magnets.

**How it works**

1. **Design once** (**/admin/store**). The easiest way: upload the finished
   design as a PNG or JPG with any placeholder QR code where the real one goes.
   The app finds that QR code, shows what it links to, and marks its spot as
   the barcode slot (drag on the image to adjust). Set the print width, and the
   page shows the resulting DPI. Each order covers the placeholder and prints
   the buyer's code in its place. Orders can be downloaded as PNG (full
   resolution) or SVG.

   You can also upload an SVG at its real print size (for example `width="24in" height="12in"`).
   - Put a rectangle with `id="barcode-slot"` where the QR code goes. Each
     order swaps that rectangle for the buyer's code, scaled to fit.
   - The barcode is the only thing that changes per person. The phone number
     and everything else print exactly as designed.
   - Pick the barcode: **Buyer's affiliate QR code** (the default), or
     **Typed in when ordering** for any other barcode (Code 128, QR, UPC-A or
     EAN-13). Add the vendor, SKU, price and print specs.
2. **Order** (**/store**). Pick the item and who it's for, and enter the
   ship-to address. For affiliate items the QR code
   fills itself in from the person picked. A live preview shows the exact
   file that will print.
3. **Fulfill** (**/store/orders**). Approve the order. Then download the
   **print file** and copy the vendor details (item, SKU, specs, quantity,
   ship-to). Place the order on the vendor's site or by email. Mark it sent
   with the vendor's order number, then shipped with the tracking number. If
   GoHighLevel is connected, the team member gets a text when it ships.
   Payment is tracked per order: unpaid, paid, payroll deduction or company
   paid.

The print file is frozen when the order is placed, so editing a design later
never changes an order that's already in progress. Barcodes are drawn as
vector shapes, so the vendor doesn't need any fonts.

**Setup**

1. Run `supabase/migrations/0004_team_store.sql` and
   `0005_affiliate_barcodes.sql`. Optionally run
   `supabase/seed/0002_merch_products.sql` for a starter 24" x 12" truck
   magnet.
2. Set `APP_URL` to this app's permanent production address. It's printed
   into every QR code, so never use a preview URL, and don't change it once
   magnets are out.
3. Set `AFFILIATE_LANDING_URL` to the page scans should land on.
4. Set `SUPABASE_SERVICE_ROLE_KEY` (already needed for check-ins). The
   public `/r/<code>` route uses it to log scans.

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
