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
