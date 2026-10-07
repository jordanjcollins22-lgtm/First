# Federal Contract Data Sources: Implementation Notes (verified 2026-10-07)

Business model: **win as PRIME, subcontract ~99% to local subs**. Daily cron pipeline: (1) ingest opportunities, (2) price-anchor from prior awards, (3) find local subs, (4) pull SCA wage floor.

**Testing note:** the keyed `api.sam.gov` endpoints could not be called from the research sandbox, so those sections follow the open.gsa.gov docs. Everything else was tested with live calls on 2026-10-07.

---

## 0. Recommended no-API-key architecture

| Need | Source | Key? |
|---|---|---|
| All open opportunities daily | SAM Contract Opportunities Full CSV (S3) | **No** |
| Attachments (SOW/PWS, WDs) | `sam.gov/api/prod/opps/v3/...` (internal, unofficial) | No |
| Incumbent / prior price | USAspending API | No |
| Local subcontractor discovery | SAM Public V2 monthly entity extract (no key) and USAspending recipient search | No |
| SCA wage rates by county | `sam.gov/api/prod/sgs` (`index=sca`) + `wdol/v1/wd` | No |
| Optional extra | SAM Opportunities API, Entity API, Contract Awards API | Yes (10/day without a role) |

---

## 1. SAM.gov Contract Opportunities: public bulk CSV (top priority)

- **URL (no key, verified):** `https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv`
  - Alternative: `https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public` → 303 to a signed S3 URL.
  - File listing (JSON): `https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Contract%20Opportunities/datagov`. S3 bucket listing returns AccessDenied. Use direct keys.
- **Size:** `Content-Length: 210853346` (about 211 MB, uncompressed CSV). `Accept-Ranges: bytes`.
- **Update frequency:** daily. Observed `Last-Modified: Wed, 07 Oct 2026 03:30:44 GMT` (about 03:30 UTC) with `x-amz-meta-lastmodifieddate: 2026-10-06`. Schedule the cron for about 05:00 UTC. Use `If-None-Match`/ETag (multipart ETag, e.g. `"…-26"`) to skip re-downloads.
- **Encoding: Windows-1252 (cp1252), NOT UTF-8.** Byte `0x96` (en dash) breaks a UTF-8 decode. Decode with `cp1252` (`errors="replace"`). There is no BOM.
- **Format:** RFC-4180, all fields quoted. **`Description` holds full multi-line HTML/text inline**, so use a real CSV parser and never split on lines.
- **Exact header row (47 columns):**
```
"NoticeId","Title","Sol#","Department/Ind.Agency","CGAC","Sub-Tier","FPDS Code","Office","AAC Code","PostedDate","Type","BaseType","ArchiveType","ArchiveDate","SetASideCode","SetASide","ResponseDeadLine","NaicsCode","ClassificationCode","PopStreetAddress","PopCity","PopState","PopZip","PopCountry","Active","AwardNumber","AwardDate","Award$","Awardee","PrimaryContactTitle","PrimaryContactFullname","PrimaryContactEmail","PrimaryContactPhone","PrimaryContactFax","SecondaryContactTitle","SecondaryContactFullname","SecondaryContactEmail","SecondaryContactPhone","SecondaryContactFax","OrganizationType","State","City","ZipCode","CountryCode","AdditionalInfoLink","Link","Description"
```
- **Value formats (real row):**
  - `PostedDate`: `2026-10-06 03:42:50`
  - `ResponseDeadLine`: ISO with offset, e.g. `2026-12-31T12:00:00+01:00`
  - `Type` and `BaseType` are words (`Special Notice`, `Solicitation`, `Combined Synopsis/Solicitation`, `Sources Sought`, `Presolicitation`, `Award Notice`…), not codes.
  - `Link` is `https://sam.gov/workspace/contract/opp/{NoticeId}/view` (public page: `https://sam.gov/opp/{NoticeId}/view`).
  - `PopState` can be a foreign subdivision (`DE-RP`).
  - **Contracting officer email and phone are included** (`PrimaryContactEmail`).
- **Gotchas:**
  - The file contains all *active* notices plus a version per notice. Dedupe on `NoticeId` and diff against yesterday's copy to get new and changed notices.
  - Filter by `NaicsCode` in your list, OR `ClassificationCode` in your PSC list, OR a title/description keyword regex (`grounds|mow|landscap|mulch|weed|pressure wash|power wash|soft wash|vegetation`). NAICS is often blank on Special Notices.
  - Historical yearly archives: `Contract Opportunities/datagov/historical/` and `Contract Opportunities/Archived Data/`.

### 1b. Key-less opportunity detail and attachments (unofficial sam.gov UI backend; verified working, may change without notice)
- **Search:** `GET https://sam.gov/api/prod/sgs/v1/search/?index=opp&q=grounds%20maintenance&page=0&size=25&sort=-modifiedDate&mode=search&is_active=true`
  - Response: `_embedded.results[]` with `_id` (= noticeId), `title`, `solicitationNumber`, `type{code,value}`, `publishDate`, `modifiedDate`, `responseDate`, `responseDateActual`, `organizationHierarchy[]{level,name,code,address}`, `award.awardee{name,ueiSAM}`, `descriptions[].content`.
  - Paging: `page{size,totalElements,totalPages,number,maxAllowedRecords:10000}`.
- **Detail:** `GET https://sam.gov/api/prod/opps/v2/opportunities/{noticeId}` → `data2{type,award,naics,title,solicitationNumber,pointOfContact,classificationCode,placeOfPerformance,…}`, `description`.
- **Attachments list:** `GET https://sam.gov/api/prod/opps/v3/opportunities/{noticeId}/resources` → `_embedded.opportunityAttachmentList[].attachments[]{resourceId,name,mimeType,size,accessLevel,postedDate}`.
- **Download:** `GET https://sam.gov/api/prod/opps/v3/opportunities/resources/files/{resourceId}/download` → 303 to S3. Skip files where `accessLevel != "public"`.

---

## 2. SAM.gov Get Opportunities Public API (official, keyed)

- **Base URL:** `https://api.sam.gov/opportunities/v2/search` (alpha: `https://api-alpha.sam.gov/opportunities/v2/search`)
- **Auth:** `api_key` query param. Get a key at sam.gov → Profile → Account Details → Public API Key (requires a Login.gov account).
- **Rate limits (open.gsa.gov):**

| Account | Limit |
|---|---|
| Non-federal user, no role | **10 requests/day** |
| Non-federal user with an entity role | 1,000/day |
| Non-federal system account | 1,000/day |
| Federal system account | 10,000/day |

  Once the company is registered in SAM (which it must be to win as a prime), its user gets a role, so the limit becomes 1,000/day.
- **Required params:** `postedFrom`, `postedTo` in **`MM/dd/yyyy`**, with a maximum range of 1 year.
- **Optional params:**
  - `ptype`: `o` Solicitation, `k` Combined Synopsis/Solicitation, `p` Presolicitation, `r` Sources Sought, `s` Special Notice, `a` Award, `u` Justification (J&A), `g` Sale of Surplus, `i` Intent to Bundle
  - `ncode` (NAICS, ≤6 digits), `ccode` (PSC)
  - `typeOfSetAside`: `SBA`, `SBP`, `8A`, `8AN`, `HZC`, `HZS`, `SDVOSBC`, `SDVOSBS`, `WOSB`, `WOSBSS`, `EDWOSB`, `EDWOSBSS`, `LAS`, `IEE`, `ISBEE`, `BICiv`, `VSA`, `VSS`
  - `state`, `zip` (place of performance)
  - `rdlfrom`/`rdlto` (response deadline, MM/dd/yyyy)
  - `solnum`, `noticeid`, `title`, `organizationCode`, `organizationName`, `status`
  - `limit` (**max 1000**, default 1), `offset`
- **Response:** `totalRecords`, `limit`, `offset`, `opportunitiesData[]` with:
  - Identity and dates: `noticeId`, `title`, `solicitationNumber`, `fullParentPathName`, `fullParentPathCode`, `postedDate` (YYYY-MM-DD), `responseDeadLine`, `archiveType`, `archiveDate`, `active`
  - Classification: `type`, `baseType`, `typeOfSetAside`, `typeOfSetAsideDescription`, `naicsCode`, `classificationCode`
  - `placeOfPerformance{streetAddress, city{code,name}, state{code,name}, zip, country{code,name}}`
  - `pointOfContact[]{type,fullName,title,email,phone,fax}`, `officeAddress{city,state,zipcode}`
  - `award{date,number,amount,awardee{name,ueiSAM,location{…}}}`
  - `description` (a **URL**: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=…`, which needs `&api_key=` appended and costs one call each), `resourceLinks[]`, `uiLink`
- **Gotchas:** returns only the latest version of each notice. Fetching each description burns quota, so the CSV is strictly better for a daily batch.

---

## 3. USAspending.gov API (no key; verified live)

- **Base URL:** `https://api.usaspending.gov`
- **Auth / limits:** no key and no published rate limit. Be polite (about 1 request/sec). Bulk use: `/api/v2/bulk_download/awards/`.

### 3a. `POST /api/v2/search/spending_by_award/`
**Real request (price anchor: prior awards, NAICS 561730, place of performance VA, VA agency):**
```json
{"filters":{"naics_codes":["561730"],"award_type_codes":["A","B","C","D"],
  "place_of_performance_locations":[{"country":"USA","state":"VA"}],
  "agencies":[{"type":"awarding","tier":"toptier","name":"Department of Veterans Affairs"}],
  "time_period":[{"start_date":"2021-10-01","end_date":"2026-10-07"}]},
 "fields":["Award ID","Recipient Name","Recipient UEI","Award Amount","Start Date","End Date",
  "Place of Performance Zip5","Description","generated_internal_id"],
 "limit":5,"page":1,"sort":"End Date","order":"desc"}
```
**Real response (truncated):**
```json
{"spending_level":"awards","limit":5,
 "results":[{"internal_id":...,"Award ID":"36C24623P1466","Recipient Name":"DMRESOLUTIONS LLC",
   "Recipient UEI":"E6REDN98SHE7","Award Amount":1717024.5,"Start Date":"2023-08-01",
   "End Date":"2027-07-31","Place of Performance Zip5":"23667",
   "Description":"GROUNDS MAINTENANCE AND LANDSCAPING",
   "generated_internal_id":"CONT_AWD_36C24623P1466_3600_-NONE-_-NONE-"}, ...],
 "page_metadata":{"page":1,"hasNext":true,"last_record_unique_id":358827854,"last_record_sort_value":"1809043200000"},
 "messages":["..."]}
```

**Verified field names:**
- Award: `Award ID`, `Recipient Name`, `Recipient UEI`, `recipient_id` (hash like `ee027e80-…-C`), `Award Amount`, `Total Outlays`, `Start Date`, `End Date`, `Base Obligation Date`, `Last Modified Date`, `Description`, `Contract Award Type`, `def_codes`
- Agency: `Awarding Agency`, `Awarding Sub Agency`, `Funding Agency`
- Place of performance: `Place of Performance State Code`, `Place of Performance City Code`, `Place of Performance Zip5`
- Classification: `NAICS` → `{code,description}`, `PSC` → `{code,description}`
- IDs: `generated_internal_id`, `prime_award_recipient_id`
- Always returned: `internal_id`, `awarding_agency_id`, `agency_slug`

**Pagination:** `page` and `limit` (max 100), loop while `page_metadata.hasNext`. Get counts from `POST /api/v2/search/spending_by_award_count/`. Same filters gave `{"contracts":3766,"idvs":663}` for 561730 in FY26.

**Filters:**
- `naics_codes`: `["561730"]` or `{"require":[...]}`
- `psc_codes`: `["S208"]` or `{"require":[["Service","S","S2","S208"]]}`
- `award_type_codes`, `time_period`, `place_of_performance_locations` and `recipient_locations` (`[{"country":"USA","state":"VA","county":"059"|"zip":"22401"}]`), `agencies`, `recipient_search_text` (name or UEI), `set_aside_type_codes` (e.g. `["SBA"]`)

**Gotchas (all observed):**
1. `award_type_codes` must come from **one group**. Mixing `A` with `IDV_B` returns an error, so query contracts (`A`,`B`,`C`,`D`) and IDVs (`IDV_A`…`IDV_E`) separately.
2. `time_period.date_type` accepts only `action_date`, `date_signed`, `last_modified_date`, `new_awards_only`. **You cannot filter on End Date**: an FY26 window returns old awards with any FY26 action, such as 2017 contracts that had de-obligations. To find expiring contracts, query a recent action window, then filter `End Date` between today and +12 months client-side, or sort `"End Date"` desc.
3. Place-of-performance data is dirty. The National Cemetery Administration showed `PoP state=VA, zip 22401` for Fort Rosecrans (CA), which is the office address. Cross-check against `Description`.
4. Task orders (`C`) roll up to an IDV. Get the parent from the `generated_internal_id` pattern `CONT_AWD_{piid}_{agency}_{parentPIID}_{agency}`.
5. A `subawards: true` request triggers the message `'subawards' will be deprecated … Set 'spending_level' to 'subawards'`. Use `"spending_level":"subawards"`.

### 3b. Award detail: `GET /api/v2/awards/{generated_internal_id}/`
- `period_of_performance{start_date,end_date,potential_end_date,last_modified_date}`: use `potential_end_date` for recompete timing.
- `base_and_all_options`: the ceiling, and the best price anchor.
- `total_obligation`, `subaward_count`, `parent_award`, `recipient{recipient_name,recipient_uei,location,business_categories}`, `place_of_performance`, `naics_hierarchy`, `psc_hierarchy`
- `latest_transaction_contract_data{type_set_aside, number_of_offers_received, extent_competed_description, solicitation_identifier, subcontracting_plan_description}`
- `number_of_offers_received` shows how competitive the requirement was.
- **Matching an opportunity to its prior award:** same awarding sub-agency/office + same NAICS/PSC + same PoP zip/city, with `End Date` within ±6 months of the new performance start. You can also match `Sol#` in the CSV against `solicitation_identifier`, though this is often null.

### 3c. Subawards (`"spending_level":"subawards"`)
- **Fields:** `Sub-Award ID`, `Sub-Award Type`, `Sub-Awardee Name`, `Sub-Recipient UEI`, `Sub-Award Date`, `Sub-Award Amount`, `Sub-Award Description`, `Prime Award ID`, `Prime Recipient Name`, `Prime Award Recipient UEI`, `prime_award_generated_internal_id`, `prime_award_recipient_id`, `Awarding Agency`, `Awarding Sub Agency`, `NAICS`, `PSC`, `prime_award_internal_id`. `Place of Performance State Code` came back null.
- **Very sparse:** only 1 subaward for 561730 in FY26 and 10 for S208 over two years. Sub reporting applies only to primes over the threshold. The example found was HALLSCAPES, L.L.C. subbing $283K to D7 LLC for "ROADS AND GROUNDS MAINTENANCE".

### 3d. Candidate subs: companies that already did this work locally
`POST /api/v2/search/spending_by_category/recipient/` with `{"filters":{"naics_codes":["561730"],"award_type_codes":["A","B","C","D"],"recipient_locations":[{"country":"USA","state":"VA","zip":"22401"}],"time_period":[…]},"limit":50,"page":1}` returns `results[]{amount,recipient_id,name,code(DUNS),uei}`. Live example: SUPEREON, LLC, $2.28M, UEI M6FUN8AT4KT4.

### 3e. Recipient profile: `GET /api/v2/recipient/{recipient_id}/`
Returns `name`, `uei`, `duns`, `parent_name`, `parent_uei`, `business_types[]`, `location{address_line1,city_name,state_code,zip,congressional_code}`, `total_transaction_amount`, `total_transactions`. **No phone or email.**

---

## 4. SAM.gov Entity data (finding local small subs)

### 4a. Public V2 monthly extract (no key; verified, and the best fit for a cron)
- **List:** `https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Entity%20Registration/Public%20V2`
- **Download:** `https://sam.gov/api/prod/fileextractservices/v1/api/download/Entity%20Registration/Public%20V2/SAM_PUBLIC_UTF-8_MONTHLY_V2_YYYYMMDD.ZIP?privacy=Public` → 303 to signed S3. Direct S3 returns 403.
  - Latest: `…_20261005.ZIP`, 150 MB, published monthly on the first Sunday.
- **Structure:** a ZIP inside a ZIP. The inner `.dat` is 572 MB, **pipe-delimited, 142 fields, no header**, with first line `BOF PUBLIC V2 00000000 20261005 0905712 0008359` and rows ending `!end`. It held 905,712 records. Field layout is in the SAM Data Dictionary folder ("SAM Master Extract Mapping"). Verified positions (0-based):
  - `0` UEI, `3` CAGE, `5` registration status (`A`), `6` purpose (`Z2` = all awards), `8` expiration date, `11` legal business name, `12` DBA
  - `15` physical address line 1, `17` city, `18` state, `19` zip5, `20` zip4, `21` country
  - `26` **entity URL**, `31` business types (`~`-separated, e.g. `2X~LJ~A5`), `32` primary NAICS
  - `34` **NAICS list with small-business flag**, e.g. `561730Y` (Y = small for that NAICS)
  - `36` PSC list
  - `39–45` mailing address
  - `46+` POC blocks: first, middle, last, title, address. Gov business POC starts at 46; alternate, past-performance and e-business POCs follow.
- **Public includes:** POC **names, titles and addresses**. **Excludes emails and phones (FOUO).**
- **Live count:** 21,463 active registrants list 561730 (TX 2,234, FL 1,896, CA 1,531, GA 1,299, VA 942). Filter by NAICS plus state/zip, then join to a zip-centroid table for radius search.

### 4b. Entity Management API (keyed)
- **Base URL:** `https://api.sam.gov/entity-information/v3/entities` (v4 also exists).
- **Same rate limits as section 2:** 10/day without a role, 1,000 with one. **`size` max 10 per page**, and only the first 10,000 records are reachable. Async extract: `format=csv|json`.
- **Params:** `ueiSAM`, `legalBusinessName`, `primaryNaics`, `naicsCode`, `naicsLimitedSB`, `pscCode`, `physicalAddressProvinceOrStateCode`, `physicalAddressZipPostalCode`, `physicalAddressCity`, `businessTypeCode` (e.g. `A2` woman-owned, `QF` SDVOSB), `sbaBusinessTypeCode` (e.g. `A6` 8(a), `XX` HUBZone), `registrationStatus=A`, `purposeOfRegistrationCode=Z2`, `q`, `includeSections=entityRegistration,coreData,assertions,pointsOfContact`, `page`, `size`.
  - Example: `?api_key=K&registrationStatus=A&naicsCode=561730&physicalAddressProvinceOrStateCode=VA&physicalAddressZipPostalCode=22401&includeSections=entityRegistration,coreData,pointsOfContact&page=0&size=10`
- **Public vs FOUO:**
  - **Public:** names, UEI, CAGE, addresses, `coreData.entityInformation.entityURL`, business types, NAICS/PSC, POC first/last name, title and address.
  - **FOUO:** POC email, phone and fax, plus hierarchy. FOUO requires a federal or system account.
  - **Sensitive:** banking and TIN.
- **Conclusion:** neither SAM channel gives you sub emails. Get them from the entity website, Google Places, or the state contractor license lookup.

---

## 5. Service Contract Act wage determinations (no key; verified)

- **Search by state/county:** `GET https://sam.gov/api/prod/sgs/v1/search/?index=sca&q={County}%20{State}&page=0&size=25&mode=search&is_active=true`
  - Results contain `fullReferenceNumber` (e.g. `2015-4281`), `revisionNumber`, `isStandard`, `isEven`, `publishDate`, `modifiedDate`, and `location.states[]{code,name,isStateWide,counties.include[]{code,value}}`.
  - Keep `isStandard:true` and match the county in `counties.include`.
  - `index=wd` mixes DBA/CBA results, so use `index=sca`. There are about two standard WDs per area: odd/even pairs differ in EO coverage.
- **Document JSON:** `GET https://sam.gov/api/prod/wdol/v1/wd/{fullReferenceNumber}/{revisionNumber}` → `{fullReferenceNumber,revisionNumber,location.mapping[]{state,counties[],statewideFlag},document(text),publishDate,standard,active}`
- **Text file:** `GET …/wdol/v1/wd/{ref}/{rev}/download` → 303 to `iae-wdol-sam-gov.s3.amazonaws.com/WDOL_FILES_PROD/SCA/CURRENT/STD/15-4281.txt`
- **Parse lines with** `^(\d{5}) - (.+?)\s+([\d.]+)$`. **Occupation codes:**
  - **`11210` Laborer, Grounds Maintenance** ($20.53 in WD 2015-4281 for DC/MD/VA)
  - `11270` Tractor Operator ($24.67)
  - `11150` Janitor ($18.19)
  - `11360` Window Cleaner
  - `23580` Maintenance Trades Helper
  - `99410` Pest Controller
  - **Correction:** `11240` is **Maid or Houseman**, not groundskeeper.
- **Fringe:** parse the `HEALTH & WELFARE:` line ($5.92/hr in this WD; the EO 13706 variant is $5.42) plus the vacation/holiday text.
- **Pricing floor** = wage + H&W + payroll burden. The WD actually attached to a solicitation is binding, so prefer the one among that notice's attachments.

---

## 6. Other sources

- **SAM Contract Awards API** (replacement for the FPDS ATOM feed): `https://api.sam.gov/contract-awards/v1/search?api_key=`
  - Params: `naicsCode`, `productOrServiceCode` (up to 100 values each), `dateSigned` and `ultimateCompletionDate` (`[MM/DD/YYYY,MM/DD/YYYY]`, so you **can** filter on completion date, unlike USAspending), `awardeeUniqueEntityId`, `piid`, `limit` (max 100), `offset`, `format`.
  - Includes `awardDetails.preferenceProgramsInformation.subcontractPlan`. Same 10/1,000 daily limits.
- **FPDS ATOM feed:** `https://www.fpds.gov/ezsearch/FEEDS/ATOM?FEEDNAME=PUBLIC&q=PRINCIPAL_NAICS_CODE:"561730" SIGNED_DATE:[2026/09/01,2026/10/01]` still returned 10 entries today. GSA announced its retirement (originally 2026-07-31). **Do not build on it.**
- **SBA SubNet:** `https://legacy.sba.gov/federal-contracting/contracting-guide/prime-subcontracting/subcontracting-opportunities`. `www.sba.gov` redirects there, and `eweb1.sba.gov/subnet` returns 403.
  - No API or RSS. Scrape the Drupal view with `?state=All&keyword=landscaping&page=N`.
  - Table `usa-table`: Description (title link `/opportunity/{slug}`, business name), Closing date, Performance start date, Place of performance, NAICS, POC (name and phone).
  - Posting is now by email to `subcontracting@sba.gov`. It is mostly construction primes, so it is useful for selling **to** primes.
- **Acquisition Gateway Forecast:** `https://acquisitiongateway.gov/forecast`. It is public, an Angular SPA with spreadsheet export. Its API endpoint is not documented. Scrape the XHR from DevTools or use export. Use it for 6–18-month lookahead on recompetes.
- **eSRS:** no public API. Its data reaches USAspending subawards (section 3c).
- **GSA Subcontracting Directory / SBA Prime Directory:** Excel lists of large primes with subcontracting plans and their small-business liaison officers (SBLOs). They matter only if you also sell to primes.
- **State portals:** these are not centralized, so each state needs its own adapter (e.g. eVA in VA, Cal eProcure, ESBD in TX). Prioritize by volume.

---

## 7. NAICS codes and SBA size standards (13 CFR 121.201, eCFR as of 2026-10-01; average annual receipts)

| NAICS | Description | Size std |
|---|---|---|
| **561730** | Landscaping Services | **$9.5M** |
| **561790** | Other Services to Buildings and Dwellings (pressure/soft washing) | **$9.0M** |
| 561720 | Janitorial Services | $22.0M |
| 561210 | Facilities Support Services | $47.0M |
| 561710 | Exterminating and Pest Control | $17.5M |
| 561740 | Carpet and Upholstery Cleaning | $8.5M |
| 238990 | All Other Specialty Trade Contractors (concrete-related) | $19.0M |

## 8. PSC codes (verified via USAspending `/api/v2/references/filter_tree/psc/`)

| PSC | Description | Relevance |
|---|---|---|
| **S208** | Housekeeping: Landscaping/Groundskeeping | **Core** |
| **S299** | Housekeeping: Other | Pressure/soft washing often lands here |
| S201 | Housekeeping: Custodial Janitorial | Exterior washing is sometimes bundled |
| S216 | Housekeeping: Facilities Operations Support | Bundled base ops |
| S218 | Housekeeping: Snow Removal/Salt | Often bundled with grounds |
| S217 | Interior Plantscaping | |
| S207 | Insect/Rodent Control | Weed spraying is sometimes coded here |
| F099 / F006 / F014 / F018 | Natural Resources: Other / Land Treatment / Tree Thinning / Other Range Improvements | Vegetation and weed control on federal lands |
| Z1xx / Z2xx | Maintenance/Repair of Buildings / Non-buildings | Exterior cleaning can land here |

**Correction:** **S214 is Carpet Laying/Cleaning**, not exterior work. Drop it.

**Suggested filter:**
- NAICS ∈ {561730, 561790, 561720, 561210}
- OR PSC ∈ {S208, S299, S216, S218, F099, F006}
- OR keyword match
