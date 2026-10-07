# Gov Contracts: win it, sub it out

An unattended pipeline for the broker model:

1. Bid on government solicitations as the **prime contractor**.
2. Hire a **local subcontractor** near the job site to do the work.
3. Price the bid at **sub quote + margin**.
4. Manage the contract (scheduling, quality control, invoicing, the government contact) and get paid net-30.

The system does the repetitive steps every hour. You review each finished bid, submit it, and make the occasional phone call.

## What runs automatically

| Step (from the playbook) | What the system does | Code |
|---|---|---|
| **1. Find opportunities** | Every day it streams SAM.gov's **keyless** full list of contract opportunities, about 76k active notices. It keeps solicitations and combined synopsis/solicitations in trades a local business can do. It scores each for bid/no-bid with factors you can see, and collapses amendments into one record. | `pipeline/discover.ts`, `scoring.ts`, `trades.ts` |
| **2. Get the scope of work** | It downloads the attachments (SOW/PWS first, then the wage determination, amendments and pricing schedule). Claude reads them and pulls out the site address, period, evaluation method, submission instructions, required contents, site visit, the FAR 52.219-14 clause and red flags. Claude also writes a **cleaned, sub-facing scope** without the solicitation number or contracting officer contacts. | `pipeline/analyze.ts`, `ai.ts`, `documents.ts` |
| **Price history** | It pulls comparable past awards from USAspending (same buying office, same area, same kind of work), annualizes them and uses the median as a price anchor. | `sources/usaspending.ts` |
| **3. Find local subs** | It runs a Google Places search for "{trade} near {job site}". It adds firms that already did this work for the government in the state (from USAspending), then scrapes each firm's website for an email. | `subfinder.ts`, `sources/places.ts`, `sources/website-email.ts` |
| **Request quotes** | It emails each sub a link to a quote form showing the cleaned scope. Quotes are due 3 days before the government deadline. It follows up on day 2 and day 4. Subs with only a phone number go on the **call list**. | `pipeline/outreach.ts`, `/quote/[token]` |
| **4. Compare quotes** | Claude checks every quote against the scope (the "12-ton vs 14-ton" problem). The system then picks the **lowest price that fully complies**. | `pipeline/evaluate.ts`, `quote-selection.ts` |
| **5. Price + proposal** | The bid is the sub quote plus the target markup (default 25%), trimmed under the prior award price when needed. It checks the subcontracting limits. Claude drafts the cover letter, technical approach, past performance (from the sub's references), price narrative and a submission checklist. | `pricing.ts`, `compliance.ts`, `ai.ts` |
| **6. Win / loss** | It watches award notices in the daily file and marks your submitted bids **won** or **lost**, recording the winning price. | `pipeline/discover.ts` |
| **Volume** | A daily digest email reports bids ready to review, the call list, and proposals submitted this month against the target. The win rate is about 5–10%, so the target is 20–25 a month. | `pipeline/digest.ts` |

**Live numbers from 2026-10-07:** 75,873 active SAM.gov notices became 618 brokerable, deduplicated candidates. The scan took about 21 seconds. Of those, 376 scored **bid** and 684 **maybe**, across janitorial, grounds, HVAC, electrical, paving, roofing, snow, tree and other trades. You can reproduce this with no setup:

```bash
curl -o /tmp/opps.csv "https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv"
npx tsx scripts/govcon-discover.ts /tmp/opps.csv --json /tmp/candidates.json
npx tsx scripts/govcon-research.ts /tmp/candidates.json <noticeId>   # docs, price history, subs
```

## What you do (the only inputs)

1. **Review and submit each bid.** Bids in "Ready to submit" have the price, the chosen sub, any warnings and a proposal draft. Fill in any `[PLACEHOLDER]`, save as PDF, and submit the way the solicitation says (usually email to the contracting officer). Then click **Mark submitted**. Submission stays manual on purpose: you are signing representations to the federal government.
2. **Work the call list** when it has entries. One call each: "Do you do commercial work? What's the best email?" Type in the email and the quote request goes out automatically. You can also log a quote you took by phone.
3. **After an award:**
   - Sign a subcontract with the sub that flows down the scope, the wage determination and the FAR clauses.
   - Collect their certificate of insurance.
   - Agree the start date and run the kickoff meeting.
   - Inspect the work, invoice the government, and pay the sub after the government pays (net-30).

## Guardrails built in (read `research/compliance-and-strategy.md`)

- **Limitations on subcontracting (FAR 52.219-14 / 13 CFR 125.6):**
  - **Small business set-asides of $15k–$350k:** exempt, so 100% sub-out is allowed unless the solicitation includes the clause anyway. Claude checks for it.
  - **Small business set-asides above $350k:** at most 50% of the award can go to subs that are not "similarly situated." The system only picks subs who confirm they are **small and self-perform**.
  - **8(a), HUBZone, SDVOSB and WOSB set-asides:** the clause applies at every dollar value. You can only bid these if you hold the certification, and the sub must hold it too.
  - **Unrestricted (full & open):** no limit on subcontracting.
  - Every bid shows the subcontracting check result.
- **Hard no-bids:**
  - Security clearances
  - Sole source / notice of intent
  - AbilityOne mandatory sources
  - Set-asides you don't qualify for
  - Overseas work
  - Under 5 days to respond
  - Over your maximum contract value
  - Product purchases (this pipeline only handles services and construction)
- **Soft flags** (shown before you submit):
  - Bonding
  - Mandatory site visit
  - On-site supervisor or key personnel
  - IDIQ or BPA
  - Base access or background checks
  - Collective bargaining (CBA) wages
  - 24/7 response
  - Sub wants a deposit
  - Price above the prior award
  - Only one quote
- **Sub-facing scope** never includes the solicitation number or government contacts, so subs can't go around you.
- **Not legal advice.** Have a government-contracts attorney review the subcontracting decision table before go-live.

## Setup

### Business prerequisites (one time)

1. An LLC with a physical address.
2. **SAM.gov registration.** You get a UEI right away and a CAGE code in about a week, and can bid once the CAGE code arrives.
   - Add NAICS codes 561730, 561720, 561790, 561710, 238210, 238220, 238160, 238320 and the others in `src/lib/govcon/trades.ts`.
   - Complete the representations and certifications.
3. Register with the SBA Small Business Search profile, and apply for any certifications you qualify for (SDVOSB, WOSB, HUBZone, 8(a)). Each one opens a set-aside pool.
4. Get general liability insurance (often $1M/$2M) and register to do business in the states you bid in, as needed.

### Technical

1. **Database.** Run `supabase/migrations/0003_govcon.sql` in your Supabase project (after 0001 and 0002).
2. **Environment.** Copy the govcon block of `.env.example` and fill in at least:

   | Variable | Needed for |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Required |
   | `CRON_SECRET` | Required |
   | `GOVCON_DASHBOARD_PASSWORD` | Required |
   | `ANTHROPIC_API_KEY` | Reading solicitations, scoping, quote checks, proposals |
   | `GOOGLE_PLACES_API_KEY` | Finding subs |
   | `RESEND_API_KEY`, `GOVCON_FROM_EMAIL`, `GOVCON_OWNER_EMAIL` | Sending quote requests and the digest |
   | `SAM_API_KEY` | Optional |

   The settings page shows which integrations are live.
3. **Deploy to Vercel.** `vercel.json` schedules the jobs:
   - `discover` daily at 05:15 UTC (after SAM rebuilds its file around 03:30 UTC)
   - `process` hourly
   - `digest` daily

   The Hobby plan only allows daily crons. Either switch `process` to daily or use Pro; the pipeline is the same either way, just slower. The "Find new bids now" and "Process pipeline now" buttons run any stage on demand.
4. Open `/govcon/settings` and enter your company name, UEI, CAGE, contact details and certifications. Everything else has working defaults.

### Rough running costs (at 25 proposals/month)

- **Claude:** about $0.25–1 per solicitation read, and the daily cap defaults to 8. Proposals and quote checks cost cents. Expect about $50–150/month.
- **Google Places:** about 6 searches per opportunity at about $0.035 each, under $10/month for most volumes.
- **Resend:** free tier to $20/month.
- **SAM.gov and USAspending:** free.

## Data sources (all verified live, see `research/federal-data-sources.md`)

| Source | Key? | Used for |
|---|---|---|
| SAM.gov Contract Opportunities daily CSV (S3) | No | All active notices, contracting-officer contacts, award notices |
| sam.gov notice detail + attachments (website backend, undocumented) | No | Full description, SOW/PWS, wage determinations |
| SAM.gov Opportunities API v2 | Free key | Same-day freshness (optional) |
| USAspending.gov API | No | Price anchors, incumbents, federally experienced local firms |
| Google Places API (New) | Paid key | Local subs near the job site |

## Roadmap (next highest-value additions)

1. **State and local bids.** No state has a documented API.
   - Start with Bonfire's public JSON (Utah and many cities and counties).
   - Then the Periscope/BidSync platforms (MD, MA, NJ, IL, NV, OR, AR) with one shared scraper.
   - The 50-state portal table is in `research/compliance-and-strategy.md`.
2. **SAM entity extract import.** Monthly, keyless, 900k registrants with a small-business flag per NAICS. Lets the system verify that subs are small and similarly situated without trusting self-certification.
3. **Wage-determination labor floor.** Parse the attached SCA wage determination (keyless endpoint documented). Then reject quotes that can't be paying the required wages; the prime is jointly liable.
4. **Sources Sought auto-responses.** Draft capability statements for Sources Sought notices, which come 30–90 days before the solicitation. These help get a requirement set aside for small business.
5. **SMS the call list** (Twilio) and **render proposal PDFs** server-side.
6. **Excel attachments.** Convert `.xlsx` pricing and frequency sheets for Claude. They are skipped today.
