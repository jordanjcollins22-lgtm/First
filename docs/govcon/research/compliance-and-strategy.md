# Win-as-Prime, Subcontract-Out: Compliance and Automation Playbook
*Exterior/facility services (grounds, mulch, weeds, janitorial, soft/pressure washing). Researched 2026-10-07. This is not legal advice. Have government-contracts counsel review the decision table before go-live.*

---

## A. Compliance rules to encode (the core of this model)

### A1. Current thresholds (effective Oct 1, 2025, per FAR inflation rule 90 FR 41872)
| Item | Value |
|---|---|
| Micro-purchase threshold (MPT) | **$15,000** (was $10k) |
| Simplified acquisition threshold (SAT) | **$350,000** (was $250k) |
| Large-prime subcontracting plan (FAR 19.702 / 52.219-9) | **$950,000** (services), **$2M** (construction) |
| SCA coverage | Service contracts **> $2,500** |
| SCA Health & Welfare fringe | **$5.55/hr** (from 7/7/2025). **$5.92/hr** (from 8/10/2026, applied as contracts or options are modified) |
| Size standards | 561730 Landscaping **$9.5M**. 561720 Janitorial **$22M**. 561210 Facilities Support **$47M**. Look up 561790 (pressure/soft wash) in the SBA table |

Sources: [Pillsbury on thresholds](https://www.pillsburylaw.com/en/news-and-insights/federal-acquisition-regulatory-council-inflation-thresholds.html), [CRS IF13123](https://www.congress.gov/crs_external_products/IF/PDF/IF13123/IF13123.1.pdf), [PilieroMazza 2026 H&W](https://www.pilieromazza.com/2026-newly-increased-health-and-welfare-rates-on-sca-government-contracts/)

### A2. Limitations on Subcontracting (LoS): FAR 52.219-14 / 13 CFR 125.6
Verified against the eCFR text and FAR 19.507(e) (FAC 2026-01):

- **Services rule:** the prime "will not pay more than 50% of the amount paid by the government to it to firms that are not similarly situated" ([13 CFR 125.6(a)(1)](https://www.ecfr.gov/current/title-13/chapter-I/part-125/section-125.6)). The limit applies to dollars paid, not labor hours. Other direct costs can be excluded only when they are not the principal purpose and small businesses do not provide them. Materials such as mulch are not clearly excluded for services, so count them conservatively.
- **Similarly situated entity (SSE):** a *first-tier* sub that (1) has the **same program status** that qualified the prime for the award and (2) is **small under the NAICS code the prime assigns to the subcontract**.
  - **Yes:** on a total small-business set-aside, a sub that is small under the NAICS (for example, a local landscaper under $9.5M) is an SSE. Its spend **counts as the prime's own performance**.
  - **Condition:** this holds only "to the extent the subcontractor performs the work **with its own employees**." Anything the SSE passes further down (lower-tier subs, 1099 crews) **counts against the prime's 50%** ([125.6(a)(1), (c)](https://www.ecfr.gov/current/title-13/chapter-I/part-125/section-125.6)).
  - Independent contractors count as subcontractors. Workers from a temp agency or PEO count as **self-performance** (125.6(d)(3)), except on staffing contracts.
  - If the sub stops qualifying as small, or loses its status, it can no longer be counted.
  - **Status must match.** SBA's own example: a WOSB prime subcontracting $500,001 of a $1M **landscaping** contract to an SDVOSB that is not a WOSB **is in violation**.
- **Where LoS does not apply:**
  - **Small-business set-asides above the MPT and at or below the SAT ($15k–$350k).** 125.6(f)(1) exempts them, and FAR 19.507(e) inserts 52.219-14 only when a set-aside is expected to exceed the SAT.
  - **Unrestricted / full-and-open awards** (no set-aside, so no LoS).
  - The unrestricted portion of a partial set-aside.
  - Micro-purchases.
- **Where LoS applies at any value:** 8(a), HUBZone, SDVOSB, and WOSB/EDWOSB set-asides and sole-source awards. FAR 19.507(e) says "regardless of dollar value" ([FAR 19.507](https://www.acquisition.gov/far/19.507), [52.219-14](https://www.acquisition.gov/far/52.219-14)).
- **Measurement period:** the base period, then **each option period**. On multi-agency vehicles it is measured per order (125.6(d)). The contracting officer (CO) can demand invoices or subcontracts at any time.
- **Other limits** if the CO assigns a construction NAICS: special trade **75%**, general construction **85%**, with materials excluded. The NAICS on the solicitation decides which limit applies.

### A3. Ostensible subcontractor and affiliation (13 CFR 121.103(h)(3))
- A non-SSE sub that performs the **"primary and vital"** requirements, or on which the prime is **"unusually reliant,"** makes the prime **ineligible as small** for that award. Any competitor can raise this in a size protest.
- **Safe harbor** (121.103(h)(3)(iii)): on a services set-aside, SBA finds no ostensible subcontractor **if the prime together with its small subs meets LoS**.
- Practical result: on small-business set-asides, subcontracting nearly everything to **small, self-performing** locals is defensible. Subcontracting it to a large firm, or to one sub that runs the job, is not.
- You may borrow a sub's past performance (h)(3)(ii), including an incumbent's.
- The prime should still visibly perform contract management, quality control, invoicing, and the CO interface.
- In a joint venture, the managing partner must perform at least 40% of the JV's work.

### A4. Penalties
- **LoS fine** (15 U.S.C. 645(d) via 125.6(h)): the greater of **$500,000** or the dollars subcontracted above the permitted level. Debarment is also possible under FAR 9.406-2.
- **Past performance:** a firm that misses LoS **cannot get a Satisfactory or better rating** without mitigating circumstances (125.6(e)).
- **False Claims Act:** every invoice and representation implicitly certifies compliance. Exposure is treble damages plus per-claim penalties. DOJ actively pursues LoS cases and "front company" cases.
- Losing small status in a size protest means losing the award.
- **SCA joint liability:** the prime is **jointly and severally liable** for a sub's underpaid wages and fringe and must flow down the clauses and the wage determination ([29 CFR 4.114(b)](https://www.law.cornell.edu/cfr/text/29/4.114)).

### A5. Decision table: how much a small prime can subcontract to non-SSE subs (services NAICS)

| Award type | Value | LoS applies? | Max to non-SSE subs | What makes ~100% sub-out compliant |
|---|---|---|---|---|
| Micro-purchase (often purchase card, not posted) | ≤ $15k | No | 100% | Anyone (SCA still applies above $2.5k) |
| Total or partial **Small Business** set-aside | $15k – $350k | **No** (125.6(f)(1)), unless the solicitation includes 52.219-14 anyway, in which case the contract terms bind | 100% | Anyone, but prefer small subs to blunt any ostensible-sub protest |
| Total or partial **Small Business** set-aside | > $350k | Yes | **50%** of amount paid, each period | Subs **small under the assigned NAICS** that self-perform |
| **8(a)** set-aside or sole source | Any | Yes | 50% | Subs that are **8(a)-certified** |
| **HUBZone** set-aside or sole source | Any | Yes | 50% | **HUBZone-certified** subs |
| **SDVOSB** (SBA VetCert) | Any | Yes | 50% | **VetCert SDVOSB** subs |
| **VA** VOSB/SDVOSB (Veterans First, VAAR 852.219-75/-76 certification) | Any | Yes | 50% | VetCert subs of the **same** status |
| **WOSB / EDWOSB** | Any | Yes | 50% | **WOSB/EDWOSB-certified** subs |
| **Unrestricted** / full & open | Any | No | 100% | Anyone. You compete with large firms, and past performance and responsibility still apply |
| Order under a full & open IDIQ competed among all | Any | No | 100% | Anyone |

**Software rules to implement:**
1. Parse the set-aside code from the SAM API `typeOfSetAside` field (SBA, SBP, 8A, 8AN, HZC, HZS, SDVOSBC, SDVOSBS, WOSB, WOSBSS, EDWOSB, VSA, VSS) and the estimated value.
2. Classify each opportunity as `LOS_NONE`, `LOS_SB_SSE` (any small sub), or `LOS_CERT_SSE` (a certified sub is required).
3. Store each sub's SAM UEI, size under the assigned NAICS, certifications, and an employee-versus-1099 attestation.
4. Recheck sub status at award and at each option period.
5. Keep a running LoS ledger per period (payments to non-SSE subs ÷ government payments received) with an alert at 45%.
6. Generate the CO compliance report automatically.
7. Watch for FAR overhaul (RFO) deviations. Part 19 is being rewritten, so key on clause text as well as clause numbers.

### A6. Registrations the prime needs
- **SAM.gov:** active registration, UEI, all target NAICS, and annual representations and certifications.
- **SBA SBS profile** (it replaced DSBS in July 2025): [search.certifications.sba.gov](https://search.certifications.sba.gov).
- **SBA certifications** where the company is eligible. Note the 2026 8(a) audits and the suspension of more than 1,000 firms ([Crowell](https://www.crowell.com/en/insights/client-alerts/8a-participants-and-the-8a-program-under-the-microscope-or-on-the-chopping-block)).
- **In each state where it bids:** foreign-entity qualification with the Secretary of State, sales and use tax registration, and state vendor registration.
- **Trade licenses:**
  - Pesticide applicator license for herbicide weed control (nearly every state; the sub can hold it, but check whether the prime must as well).
  - Landscape contractor licenses (for example, CA C-27).
  - Pressure-wash wastewater runoff rules (Clean Water Act and local).

---

## B. Win factors for the broker model

**Target (green flags):**
- Firm-fixed-price, recurring services with a clear performance work statement and a quantified scope (acres, mow cycles, square feet), priced LPTA or simplified (FAR 13 / combined synopsis-solicitation)
- A base year plus 1–4 option years
- **$15k–$350k small-business set-asides**, where no LoS applies
- Unrestricted awards under $1M where few large firms bid
- Place of performance in a metro area with many small landscaping and janitorial firms

**Red flags (penalize or auto-reject):**
- Recent, relevant past performance required as pass/fail, or weighted above price. (FAR 15 gives no record a neutral rating, but tradeoff source selections still favor incumbents.)
- **A mandatory site visit** or pre-bid meeting. A local sub can attend if the solicitation allows a representative.
- Bid, performance, or payment bonds
- Security clearance, base access (DBIDS/CAC), or background checks for every crew
- Named key personnel or a full-time **on-site supervisor or project manager** employed by the prime (this can also feed an ostensible-sub finding)
- 24/7 emergency response, or equipment the government will own
- **AbilityOne Procurement List** items, which are mandatory sources: check [abilityone.gov/procurement_list](https://www.abilityone.gov/procurement_list/)
- Certified-only set-asides the company lacks
- Union or CBA successor wage determinations, and the Nondisplacement EO (incumbent workforce)

**Pricing:**
1. **Price floor = SCA wage determination labor cost.**
   - Pull the WD for the county and occupation from [sam.gov/wage-determinations](https://sam.gov/wage-determinations). Laborer, Grounds Maintenance is occupation 11210 (verified in WD 2015-4281). Janitor is 11150.
   - Add H&W of $5.55 or $5.92 per hour, vacation and holidays, FICA/FUTA/SUTA, workers' comp, GL insurance, and equipment and fuel.
   - The sub's quote must equal or exceed this floor. A quote below it is a red flag for joint SCA liability.
2. **Anchor on history.** Pull the incumbent's prior obligations from USAspending, divide by years, and apply a CPI and WD escalation. A verified call that returns recipient, amount, and end date:
   `POST https://api.usaspending.gov/api/v2/search/spending_by_award/` with `naics_codes`, `psc_codes` (S208 Landscaping/Groundskeeping, S201 Custodial, S216 Facilities Ops), and `place_of_performance_locations`.
3. **Markup.**
   - Brokers commonly target **15–30% gross margin** on the sub's price. This is a practitioner norm, not regulation.
   - Competitive LPTA bids often compress margin to **10–15%**.
   - The model should be: bid = max(sub quote × (1 + m), WD floor × 1.1). Reject the bid if the result exceeds the historical anchor by more than 15%.
4. **Cash flow.** Government pays net 30 under the Prompt Payment Act. Subs expect weekly or biweekly pay, so plan working capital or factoring.

**Lead time** (posting to response deadline):
- FAR 5.203: synopsis at least 15 days before solicitation, and at least 30 days to respond, for non-commercial awards above the SAT.
- Commercial services, combined synopsis/solicitations, and buys under the SAT allow a "reasonable" time, typically **5–15 days** (often 7–10).
- **Sources Sought and presolicitation notices give 30–90 days of warning.** Ingest them, line up subs early, and reply to Sources Sought so the CO sees small-business interest (the rule of two).
- Contracts at $15k–$25k are posted locally rather than on SAM. Micro-purchases (≤ $15k) need direct outreach to base purchase-card holders.
- **Recompetes:** filter USAspending for contracts whose period of performance ends in 4–12 months.
- **Do not chase awards under 5 days to deadline** unless a sub is already qualified in that ZIP code.

**Federal data sources (all API):**
- SAM Opportunities API v2: `https://api.sam.gov/opportunities/v2/search` (free key; daily rate limits). The Interested Vendors List is not in the API.
- SAM Contract Awards API ([open.gsa.gov](https://open.gsa.gov/api/contract-awards/)). The FPDS ATOM feed was retired in 2026.
- USAspending (no key)
- DoD daily contract announcements: [defense.gov/News/Contracts](https://www.defense.gov/News/Contracts/)

---

## C. Finding subcontractors near the place of performance

| Source | API? | Notes |
|---|---|---|
| **SAM.gov Entity API** v3/v4 ([open.gsa.gov/api/entity-api](https://open.gsa.gov/api/entity-api/)) | **Yes**, free key | Filter by NAICS, state, ZIP, and business types (SBA cert flags). Returns POC, UEI, CAGE. 10 per page, max 10,000 per query. Bulk extracts also available. **Best source for SSE verification.** |
| **SBA SBS** ([search.certifications.sba.gov](https://search.certifications.sba.gov)) | No official API (third-party scrapers exist) | Has emails, capability narratives, and SBA certifications. Scrape politely or search manually |
| SBA SubNet ([subnet.sba.gov](https://subnet.sba.gov/client/dsp_Landing.cfm)) | No | Lets you post your own sub-opportunity notices |
| State certification and vendor directories (SBE, MBE/WBE, UCP DBE) | Mostly HTML or CSV downloads | Note: USDOT's Oct 2025 interim final rule ended race/sex presumptions, so DBEs are being re-evaluated and goals are paused until UCPs finish ([Federal Register](https://www.federalregister.gov/documents/2025/10/03/2025-19460/disadvantaged-business-enterprise-program-and-disadvantaged-business-enterprise-in-airport)) |
| **Google Places API (New)** Text Search | **Yes** | Text Search Pro about $32 per 1,000 after 5k free each month. Enterprise ($35) adds phone, website, rating. Query "landscaping near {POP}" within a radius |
| **Yelp Fusion** | **Yes**, paid | $7.99–$14.99 per 1,000 calls with daily quotas |
| Thumbtack | Partner-only (OAuth, approval needed) | [developers.thumbtack.com](https://developers.thumbtack.com/request-access) |
| Angi | No public API | Manual only |

Recommended pipeline:
1. Geocode the place of performance.
2. Pull SAM entities with the NAICS within 50 miles. These are SSE-capable and preferred.
3. Supplement with Google Places for firms not in SAM.
4. Send RFQs.
5. Require a SAM UEI from any sub you award. A sub must be small under the assigned NAICS to count as an SSE, and you need the UEI for subaward reporting, which moved to SAM.gov in March 2025.

---

## D. Scoring rubric, RFQ template, bid/no-bid checklist

### D1. Opportunity score (0–100)
| Factor | Wt | Scoring |
|---|---|---|
| LoS fit | 20 | `LOS_NONE` = 20. `LOS_SB_SSE` with at least 3 small subs found = 14. `LOS_CERT_SSE` where you hold the cert and certified subs exist = 8. Otherwise disqualify |
| Scope sub-ability (FFP, recurring, defined quantities, NAICS 561730/561720/561790) | 15 | Fully defined = 15. Vague or "as needed" = 5 |
| Local sub density (SAM + Places firms within 50 miles) | 15 | ≥10 = 15. 5–9 = 10. 1–4 = 5 |
| Evaluation method | 10 | LPTA or simplified = 10. Tradeoff = 5. Past performance pass/fail = 0 |
| Margin potential (historical anchor vs. WD floor) | 15 | Anchor ≥ 1.35× floor = 15. 1.2× = 10. < 1.1× = 0 |
| Red-flag count (bonding, clearance, key personnel, mandatory visit, on-site PM, AbilityOne) | 10 | 0 flags = 10. Minus 4 per flag |
| Time to deadline | 5 | ≥ 14 days = 5. 7–13 = 3. < 7 = 0 |
| Value band | 5 | $25k–$350k = 5. $350k–$2M = 3. Other = 1 |
| Duration (option years) | 5 | 1+4 = 5. 1+2 = 3. One-time = 2 |

Bid if the score is ≥ 65. Review if 50–64. Skip if below 50.

### D2. RFQ email to local subs (auto-filled)
> **Subject:** Subcontract quote request – {Service} at {Facility}, {City, ST} – due {date}
>
> Hi {Name},
>
> {Company} (UEI {UEI}, small business) is preparing a prime bid to {Agency} for {service summary} at {address}. Solicitation {number}. Response due to the government {date}.
>
> **Scope:** {acres / sq ft / frequency, from the PWS}. Period: base year {dates} plus {n} option years. The SOW and wage determination {WD#} are attached.
>
> Please reply by **{date − 3 days}** with:
> 1. A firm-fixed price per year (and per visit, if applicable)
> 2. Your SAM UEI, or confirmation you will register
> 3. Confirmation that the work will be done by **your own W-2 employees** and that you are small under NAICS {code}
> 4. A COI showing at least GL $1M/$2M, auto $1M, and statutory workers' comp
> 5. Any state licenses (for example, pesticide applicator)
> 6. Two references
>
> This is a federal service contract. **Service Contract Act wages and fringe** under the attached WD will be flowed down and must be paid. If we win, we will issue a subcontract within {x} days of award and pay net {15/30} after the government accepts the work.
>
> Thanks, {Name / phone}

Follow-up cadence: send on day 0, an SMS or email nudge on day 2, a call on day 4, and close the RFQ 3 days before the government deadline. Ask for at least 3 quotes per opportunity.

### D3. Bid/no-bid checklist (all must be true)
- [ ] SAM is active, the NAICS is on our registration, and we are small under the size standard
- [ ] The set-aside type is mapped to a LoS class, and we hold any required certification
- [ ] Not on the AbilityOne list. No clearance, bonding, or key-personnel blockers, or each one is mitigated
- [ ] At least 2 qualified sub quotes. Any sub counted toward LoS is a verified SSE (UEI, size, cert, W-2 attestation)
- [ ] The sub price is at or above the WD floor, and our bid falls within the band of historical awards
- [ ] LoS ledger projection is ≤ 50% non-SSE per period, where LoS applies
- [ ] The prime keeps contract management, QC, and CO communication (ostensible-sub defense)
- [ ] Insurance meets the solicitation's requirements and the FAR 28.307 minimums. State registration and licenses are complete
- [ ] Working capital covers at least 60 days of sub payroll
- [ ] Site visit is attended (by us or an allowed sub representative), or not required
- [ ] Every amendment has been acknowledged

---

## E. State central procurement portals (for per-state ingestion)

**Key:**
- **API** = official or documented JSON
- **JSON*** = undocumented public JSON endpoint (works today but may change)
- **Scrape** = public search without login, HTML or JS-rendered
- **Login** = full details or documents need a vendor account

No state publishes a documented bid API. Group the scrapers by platform:
- **Periscope BSO:** public open-bids page at `/bso/view/search/external/advancedSearchBid.xhtml?openBids=true`
- **Ivalua:** `/page.aspx/en/rfp/request_browse_public`
- **CGI Advantage VSS:** anonymous public access, JS-heavy, so use a headless browser
- **Bonfire:** `{org}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData` returns JSON (verified on the Utah portal)
- **JAGGAER:** public event router

| State | Portal | URL | Access |
|---|---|---|---|
| AL | STAARS VSS (CGI) | procurement.staars.alabama.gov | Scrape (JS) |
| AK | IRIS VSS + Online Public Notices | iris-vss.alaska.gov · aws.state.ak.us/OnlinePublicNotices | Scrape |
| AZ | Arizona Procurement Portal (Ivalua) | app.az.gov/page.aspx/en/rfp/request_browse_public | Scrape |
| AR | ARBuy (Periscope) | arbuy.arkansas.gov | Scrape |
| CA | Cal eProcure | caleprocure.ca.gov | Scrape (bot-protected) |
| CO | Colorado VSS (CGI) | prd.co.cgiadvantage.com/PRDVSS1X1/Advantage4 | Scrape (JS) |
| CT | CTsource | portal.ct.gov/das/ctsource/ctsource | Scrape |
| DE | MyMarketplace | mmp.delaware.gov | Scrape |
| DC | OCP solicitations | ocp.dc.gov | Scrape |
| FL | Vendor Bid System (MFMP) | vendor.myfloridamarketplace.com/search/bids | Scrape |
| GA | Georgia Procurement Registry | ssl.doas.state.ga.us/gpr/ | Scrape |
| HI | HANDS | hands.ehawaii.gov/hands/opportunities | Scrape (bot-protected) |
| ID | Luma (Ivalua) | luma.idaho.gov | Scrape |
| IL | BidBuy (Periscope) | bidbuy.illinois.gov/bso/ | Scrape |
| IN | IDOA current opportunities | in.gov/idoa/procurement/current-business-opportunities/ | Scrape |
| IA | Bid Opportunities | bidopportunities.iowa.gov | Scrape |
| KS | eSupplier | supplier.sok.ks.gov | Scrape or login |
| KY | eMARS VSS (CGI) | emars311.ky.gov/webapp/vssonline/AltSelfService | Scrape (JS) |
| LA | LaPAC | wwwcfprd.doa.louisiana.gov/osp/lapac/pubMain.cfm | Scrape |
| ME | BBM RFP page | maine.gov/dafs/bbm/procurementservices/vendors/rfps | Scrape |
| MD | eMMA (Periscope) | emma.maryland.gov | Scrape |
| MA | COMMBUYS (Periscope) | commbuys.com/bso/ | Scrape |
| MI | SIGMA VSS (CGI) | sigma.michigan.gov/PRDVSS1X1/Advantage4 | Scrape (JS) |
| MN | SWIFT Supplier Portal | mn.gov/admin/osp/vendors/ | Scrape or login |
| MS | Contract/Bid Search | ms.gov/dfa/contract_bid_search/ | Scrape |
| MO | MissouriBUYS | missouribuys.mo.gov | Scrape or login |
| MT | eMACS (JAGGAER) | bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfMontana | Scrape |
| NE | Bid opportunities | das.nebraska.gov/materiel/bidopps.html | Scrape |
| NV | NevadaEPro (Periscope) | nevadaepro.com/bso/ | Scrape |
| NH | DAS bids | apps.das.nh.gov/bidscontracts/bids.aspx | Scrape |
| NJ | NJSTART (Periscope) | njstart.gov/bso/ | Scrape |
| NM | GSD State Purchasing | generalservices.state.nm.us/state-purchasing/ | Scrape |
| NY | NY Contract Reporter | ny.newnycontracts.com | Login for details |
| NC | eVP (Ivalua) | evp.nc.gov | Scrape |
| ND | SPO solicitation search | apps.nd.gov/csd/spo/services/bidder/searchSolicitation.htm | Scrape |
| OH | OhioBuys (Ivalua) | ohiobuys.ohio.gov/page.aspx/en/rfp/request_browse_public | Scrape |
| OK | OMES solicitations | oklahoma.gov/omes/divisions/central-purchasing/solicitations.html | Scrape |
| OR | OregonBuys (Periscope) | oregonbuys.gov/bso/ | Scrape |
| PA | eMarketplace | emarketplace.state.pa.us/Search.aspx | Scrape |
| RI | Ocean State Procures (Ivalua) | ridop.ri.gov | Scrape |
| SC | SCBO + procurement | scbo.sc.gov · procurement.sc.gov | Scrape |
| SD | BHRA bids/RFPs | sd.gov/bhra?id=bidsrfps | Scrape |
| TN | CPO RFP opportunities | tn.gov/generalservices/procurement.html | Scrape |
| TX | ESBD | txsmartbuy.gov/esbd | Scrape (check whether CSV export exists) |
| UT | U3P on Bonfire | utah.bonfirehub.com/portal | **JSON*** |
| VT | Business Registry & Bid System | vermontbusinessregistry.com/BidSearch.aspx | Scrape |
| VA | eVA | mvendor.cgieva.com/Vendor/public/AllOpportunities.jsp | Scrape |
| WA | WEBS | pr-webs-vendor.des.wa.gov | Scrape or login |
| WV | wvOASIS (CGI) | wvoasis.gov | Scrape (JS) |
| WI | VendorNet | vendornet.wi.gov | Scrape |
| WY | Public Purchase | publicpurchase.com (A&I: ai.wyo.gov) | Login |

All URLs were reachable on 2026-10-07 except CA, HI, NH, and RI (bot protection) and KY and NM (timeouts). Re-verify these six with a headless browser.

**Aggregators for local governments** (cities, counties, schools; this is where most small grounds and janitorial bids are posted):
| Aggregator | Access |
|---|---|
| **Bonfire** | Public per-org JSON* (best target) |
| **OpenGov** | Scrape |
| **PlanetBids** | Scrape per agency |
| **BidNet Direct** ([bidnetdirect.com](https://www.bidnetdirect.com)) | Free tier, login for documents, no public API |
| **DemandStar** | Login, no API |
| **Periscope/BidSync** | Paid, no public API |
| **GovSpend** ([govspend.com](https://govspend.com)) | Paid. Data delivery on enterprise contracts only |

Third-party Apify actors already scrape BidNet, DemandStar, Bonfire, OpenGov, and PlanetBids. That is a fast way to start, but check each site's terms of service.

**State and local LoS:** most states have no 50% rule. Small-business and DBE programs, however, require a **"commercially useful function"** (CUF): a certified prime that passes work through can lose credit or face fraud claims. Federal-aid highway DBE goals are paused while DBEs are re-evaluated (Oct 2025 interim final rule).

---
**Key sources:**
- [13 CFR 125.6 (eCFR)](https://www.ecfr.gov/current/title-13/chapter-I/part-125/section-125.6)
- [13 CFR 121.103](https://www.ecfr.gov/current/title-13/chapter-I/part-121/section-121.103)
- [FAR 19.507](https://www.acquisition.gov/far/19.507)
- [FAR 52.219-14](https://www.acquisition.gov/far/52.219-14)
- [29 CFR 4.114](https://www.law.cornell.edu/cfr/text/29/4.114)
- [SAM Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/)
- [SAM Entity API](https://open.gsa.gov/api/entity-api/)
- [FPDS sunset](https://support.govspend.com/fpds-sunset)
- [SBS replaces DSBS](https://smallgovcon.com/federal-government-contracting/sba-introduces-its-new-small-business-search-system/)
- [Subaward reporting moved to SAM](https://sam.gov/alerts/subaward-reporting-live-samgov)
- [DBE IFR (Jones Day)](https://www.jonesday.com/en/insights/2025/11/federal-government-removes-race-and-sexpresumptions-in-transportation-contracts)
- [Google Places pricing](https://openplacesapi.com/blog/google-places-api-pricing)
- [Yelp Fusion pricing](https://appdevelopermagazine.com/yelp-fusion-api-outrageous-new-pricing/)
- [SIOE state portal list](https://www.sioe.org/online-databases-contracts-us-state-governments)
