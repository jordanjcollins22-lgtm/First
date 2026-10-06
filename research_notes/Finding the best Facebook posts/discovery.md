# Discovering Homeowner "Recommendation Request" Posts (Facebook, Nextdoor, Reddit) — Harford County, MD Landscaping, 2025-2026

Research date: 2026-10-06. 17 tool calls. Several sources are vendor blogs (marked); treat their claims about competitors with caution.

## 1. Which Facebook groups produce the most "anyone know a good landscaper" posts, and how to find/pick them

### Takeaway
General guidance points to local community groups, neighborhood groups and local buy/sell groups as the main places homeowners ask for service recommendations, and says to read each group's promotion rules first. I found no published data ranking group types (moms vs town vs HOA vs buy/sell) by volume of requests, and no public list of active Harford County groups.

### Cited Findings
- Lawn care marketing guidance says to "find and join local community groups, home improvement forums, or local buy/sell groups," calls them prime places to find people looking for lawn care, and says to follow each group's rules on promotion — [MowMore](https://mowmore.com/blogs/news/how-to-market-your-landscaping-business-using-facebook-groups); similar advice from [NiceJob](https://get.nicejob.com/resources/how-to-get-more-lawn-care-customers) and [Jobber](https://getjobber.com/academy/lawn-care/how-to-get-lawn-care-customers-fast/)
- Recommended approach: answer lawn and landscaping questions without pushing sales, and post before/after photos where the rules allow — [MowMore](https://mowmore.com/blogs/news/how-to-market-your-landscaping-business-using-facebook-groups)
- Local Facebook presences that showed up in search (these are mostly Pages, not member groups): "The Harford County Mom" ([FB](https://www.facebook.com/theharfordcountymom/)), "Hello Harford" ([FB](https://www.facebook.com/helloharford/)), Town of Bel Air government ([FB](https://www.facebook.com/BelAirMD/)), Harford County Chamber ([FB](https://www.facebook.com/harfordchamber/)). Web search did not return private community groups for Bel Air, Abingdon or Fallston — [search result set](https://www.facebook.com/theharfordcountymom/)
- Lead-alert vendor Leadhall says first-responder speed decides who wins ("the first contractor to respond wins the job 78% of the time"). This is vendor marketing and the claim is unverified — [Leadhall](https://leadhall.com/)
- Leadhall says it shows how many request posts appeared in your zip codes over the last 90 days during onboarding. That would be one way to measure local volume — [Leadhall](https://leadhall.com/)

### Inferences
- Search engines don't index Facebook groups well, so the practical way to find Harford County groups is Facebook's own Groups search. Search town names ("Bel Air MD", "Abingdon MD", "Fallston", "Edgewood MD", "Joppa", "Aberdeen MD", "Harford County") together with words like "community", "neighbors", "moms", "buy sell", "recommendations", "what's happening". Then rank groups by how many posts they get per day (the group "About" panel shows this) and by member count.
- How to choose: pick groups where (a) at least a few posts a day are local "ISO / recommendations" posts, (b) the rules allow businesses to reply to recommendation requests (many ban self-promotion but allow replies when someone asks), and (c) members are homeowners. HOA and neighborhood groups are smaller, but the leads are the right households and there are fewer competing contractors.
- Snow removal and leaf cleanup requests come in short seasonal bursts (first snow; Oct–Dec). Watch alerts more closely during those windows.

### Gaps
- No source quantified which group type (moms, town, buy/sell, HOA, "recommendations") produces the most service-request posts.
- No public listing of specific Harford County community groups with member counts. This has to be gathered by hand inside Facebook.
- No source covered how common "no business replies" admin rules are.

## 2. Facebook search: searching posts in groups today, sorting by newest, phrases

### Takeaway
Since about September 2025, Facebook's global search has lost the dedicated "Posts" filter for many users. Searching inside a single group still works and still offers a "Most Recent" toggle, a year filter and a "Posted by" filter. Group-by-group search, with Most Recent turned on, is now the reliable way to surface new requests by search.

### Cited Findings
- Facebook quietly removed the "Posts" filter from search across platforms. Reported September 11, 2025 — [PiunikaWeb](https://piunikaweb.com/2025/09/11/facebook-posts-search-filter-removed/)
- Reports of the missing filter continued through August 2026. Meta has not confirmed a permanent, universal removal and has not explained it. No setting brings it back, and clearing cache or reinstalling doesn't help — [iTechGuides](https://www.itechguides.com/facebooks-posts-search-filter-is-missing-for-many-users-what-still-works/)
- Workarounds that still work: search inside the relevant group, browse Feeds for recent content, use Activity Log for your own posts — [iTechGuides](https://www.itechguides.com/facebooks-posts-search-filter-is-missing-for-many-users-what-still-works/)
- How to search inside a group (2026): open the group → search icon → enter the keyword → "Search this group for [keyword]". Filters: **Most Recent**, **Date** (by year), **Posted By** (anyone / you / friends), **Posts You've Seen**, **Location** — [Groupboss](https://groupboss.io/blog/search-facebook-group-posts/)

### Inferences
- For the extension: loop a per-group search for each target group, with "Most Recent" turned on, over a short phrase list. Expect global "Posts" search results to be missing or inconsistent depending on the account's rollout bucket. Code should handle both cases rather than assume either.
- Phrases (short, the way people actually write): "landscaper", "lawn guy", "lawn care", "lawn service", "mowing", "mow my", "grass cutting", "leaf removal", "leaf cleanup", "fall cleanup", "spring cleanup", "mulch", "hedge trimming", "aeration", "overseeding", "sod", "yard cleanup", "snow removal", "plow", "shovel driveway", plus intent words: "recommend", "recommendations", "anyone know", "looking for", "ISO", "need someone". Matching these as keyword + intent pairs on the extension side cuts false positives (e.g., people offering services or selling mowers).
- The year-level Date filter is too coarse for freshness. Rely on "Most Recent" and the post's own timestamp.

### Gaps
- No official Facebook Help Center page confirming the current group search filters. The sources are third-party.
- Whether the global search URL parameters still return group posts for every account in 2026 was not confirmed.

## 3. After Meta removed the Groups API (April 22, 2024): what's impossible, what tools remain, costs

### Takeaway
Meta deprecated the Facebook Groups API in Graph API v19.0 (January 2024) and removed it from all versions on April 22, 2024, including `groups_access_member_info` and `publish_to_groups`. No official, sanctioned way remains to read group posts programmatically. Every monitoring product now works one of three ways: a browser extension running inside your logged-in session, a vendor-run cloud monitor, or a managed service. Facebook has no native keyword alerts for ordinary members.

### Cited Findings
- The Groups API (permissions `publish_to_groups` and `groups_access_member_info`, plus the related Reviewable Features) was deprecated in v19.0 and removed from all versions on April 22, 2024 — [Ayrshare](https://www.ayrshare.com/blog/facebook-removes-groups-api-access-impact-and-implications/); [Meta dev community thread](https://developers.facebook.com/community/threads/584177870580474/)
- Before removal the API allowed posting, deleting, and reading historical group posts. Meta gave no official reason — [Ayrshare](https://www.ayrshare.com/blog/facebook-removes-groups-api-access-impact-and-implications/)
- "Facebook has no native keyword alert system for group monitoring" (for members). Meta's API limits keep enterprise listening tools out of private groups, which leaves browser extensions as the practical workaround — [OneStopSocial (vendor blog)](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools)
- Tool landscape. Prices are as published; each vendor writes about its rivals, so cross-check:
  - **OneStopSocial**: Chrome extension that reads groups through your own browser session, private groups included. $29/mo, 25 groups (5 on trial). Alerts by email, browser notification, or webhook (Zapier/Make/Slack). Says its AI catches requests that contain none of your keywords — [OneStopSocial](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools); [home](https://onestopsocial.com/)
  - **Devi AI**: browser extension covering about 11 platforms. $49/mo Facebook plan, 25 groups. Dashboard plus webhooks — [OneStopSocial comparison](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools); [Devi guide](https://ddevi.com/en/blog/how-to-monitor-facebook-groups-for-lead-generation-complete-2025-guide)
  - **Syndr AI**: browser extension. $49/mo Basic: 25 FB groups plus 15 subreddits, 20 keywords — [OneStopSocial comparison](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools); [Syndr](https://www.syndr.ai/facebook-group-monitoring-tool)
  - **Groups Watcher**: its own site describes a cloud service that needs no Facebook login. AI intent filtering, alerts "within 60 seconds," public and private groups. $99/mo for 25 groups, +$4/mo per extra group, 7-day refund. Alerts to Slack, email, Discord, Google Chat, Teams, or webhooks — [Groups Watcher](https://www.groupswatcher.com/). **Conflict:** OneStopSocial says Groups Watcher has moved to a done-for-you, consultative-priced service for US home services that covers Facebook and Nextdoor — [OneStopSocial](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools). A third party also markets it to contractors for Facebook groups and Nextdoor — [MicroSaaSExamples](https://www.microsaasexamples.com/p/groups-watcher)
  - **Leadhall**: aimed at contractors. Monitors Nextdoor and Facebook 24/7 and says it "never logs into your accounts or scrapes from your browser." Average alert under 5 minutes, sent by email, SMS or Slack. From $99/mo (varies by coverage area), no contract. Claims 165,000+ US neighborhoods. Lists landscapers among the trades served — [Leadhall](https://leadhall.com/)
  - **Narrative Field**: managed monitoring of public and private groups with AI keyword alerts. No Facebook login or extension needed — [Narrative Field](https://narrativefield.com/). **Groups-Monitor** is another keyword-alert product — [groups-monitor.com](https://groups-monitor.com/) (pricing not checked)
  - **Build it yourself**: scraper or browser automation. No subscription, but it breaks whenever Facebook's interface changes — [OneStopSocial](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools)
- **Admin-only native option:** group admins can set **Keyword Alerts** (Admin Tools → Keyword Alerts / Moderation Alerts → Edit Alerts → Keywords; URL `facebook.com/groups/[GROUPID]/keyword_alerts`). Admins get a notification when a post or comment contains the keyword, and only admins can see these alerts. Facebook built it for moderation, but it can also flag brand or product mentions — [Groupboss](https://groupboss.io/blog/facebook-group-keyword-alerts/amp/); [TechCrunch, 2021 (older)](https://techcrunch.com/2021/06/16/facebook-rolls-out-new-tools-for-group-admins-including-automated-moderation-aids/); [Social Media Today (older test coverage)](https://www.socialmediatoday.com/news/facebooks-testing-new-keyword-alerts-for-groups/543474/)

### Inferences
- The user's Chrome extension already belongs to the same class as OneStopSocial, Devi and Syndr (logged-in session, reads private groups the account has joined). The paid tools add mainly scheduling, around-the-clock polling, AI intent classification and alert routing. The cheapest upgrade is to add timed per-group "Most Recent" searches and push notifications to the extension, not to buy a tool.
- Cloud tools that "don't need your login" must use their own accounts or scrapers. Coverage of a specific private Harford County group depends on whether the vendor's account is a member. Ask vendors to confirm specific groups before paying.
- Account-risk claims (that extensions get accounts banned) come from competing vendors. No independent data on ban rates was found.
- Starting your own Harford County group (e.g., a "Harford County Home & Yard Recommendations" group) gives you admin Keyword Alerts on that group. This is the only native, legitimate keyword alert route.

### Gaps
- No primary Meta source in 2025-2026 confirming the current location of the Keyword Alerts admin feature.
- Pricing for Narrative Field, Groups-Monitor and Syndr's upper tiers was not verified directly.
- Groups Watcher's current model (self-serve $99/mo vs managed) is contradicted between sources.

## 4. Notification tricks: FB group notifications, admin keyword alerts, Nextdoor alerts, Reddit keyword alerts / API rules

### Takeaway
On Facebook, members can't get keyword alerts. Only admins get them, as covered in §3. For Reddit, free third-party keyword monitors (F5Bot, Notikey) let you skip API access entirely, because new official API access now needs manual approval and commercial use requires a contract.

### Cited Findings
- Admin Keyword Alerts as above. Only admins see them — [Groupboss](https://groupboss.io/blog/facebook-group-keyword-alerts/amp/)
- Reddit official API: free tier is 100 queries/min per OAuth client ID, averaged over 10 minutes, non-commercial use only. Unauthenticated (non-OAuth) API traffic is rejected. No self-serve commercial price is published; the much-quoted $0.24 per 1,000 calls comes from the June 2023 announcement and is not on a current Reddit page — [SocialCrawl 2026](https://www.socialcrawl.dev/blog/reddit-api-key-limits-alternatives-2026)
- Self-service API registration is reported closed. New OAuth tokens need manual approval, which takes about 2–4 weeks, and a business justification for commercial use — [Octolens](https://octolens.com/blog/reddit-api-pricing); [SocialCrawl](https://www.socialcrawl.dev/blog/reddit-data-api-2026) (secondary sources; I did not find Reddit's own policy page)
- **F5Bot** emails you when a keyword appears in new Reddit posts or comments, and supports a subreddit restriction (`only-subreddit=...`). The free tier has delayed alerts and daily caps per keyword; paid plans alert promptly. One search snippet said the free plan is 5 keywords, 10 alerts/day per keyword, delivered within 2 hours — [F5Bot guide](https://f5bot.com/guides/reddit-keyword-alerts) (exact paid prices not captured)
- **Notikey**: Reddit keyword monitor for chosen subreddits, with a free option — [AlternativeTo](https://alternativeto.net/software/notikey)
- Syndr's $49 plan includes 15 subreddits — [OneStopSocial](https://onestopsocial.com/en/blog/facebook-group-monitoring-tools)

### Inferences
- Reddit volume for Harford County lawn requests is probably low. The relevant subs are likely r/harfordcounty, r/baltimore and r/maryland, and these were not verified. A free F5Bot alert such as `landscaper only-subreddit=harfordcounty` is enough, and there's no reason to build API access.
- Facebook: turning on "All posts" notifications for the 3–5 highest-yield groups (via the group's Notifications setting) pushes every new post to your phone with no tooling. This comes from general product knowledge and is **not verified by a source in this research.**

### Gaps
- No primary source on Facebook's current per-group "All posts" notification setting or its throttling.
- Nextdoor alert settings (email digests, per-post notifications, keyword alerts) were not documented. I found no evidence that Nextdoor offers user keyword alerts.
- Reddit's own 2025-2026 policy page (the reported "Responsible Builder" policy) was not found.

## 5. Nextdoor specifics: business page vs personal replies, rules, Recommendations

### Takeaway
Officially, Nextdoor lets businesses reply to recommendation requests but requires that you disclose your involvement. In 2026, though, user reports describe a phased change. Landscaping and other service categories reportedly were hit first, from late May through July 2026. Personal profiles can no longer mention businesses, and commenting on neighbors' requests as a business reportedly requires a paid plan ($80 to $2,000+/mo reported). Treat Nextdoor as a pay-to-play channel for this trade unless you confirm otherwise in your own account.

### Cited Findings
- You may reply to recommendation requests and tag your Business Page, but you must disclose your personal involvement with the business to stay within community guidelines — [Podium](https://www.podium.com/article/nextdoor-reviews)
- Recommendations show on your Business Page and wherever your business is mentioned in neighbors' posts. Pages with recommendations get "up to 19X more views." The "Your Reputation" tab shows recommendations so you can respond. Verified businesses get free Business Posts (a 2019–2023 era blog says two per month; a newer one says free and unlimited) — [Nextdoor Business blog](https://business.nextdoor.com/en-us/blog/small-business-guide-to-getting-nextdoor-recommendations) (updated Jan 2023, **older**); [Nextdoor holiday posts blog](https://business.nextdoor.com/en-us/small-business/resources/blog/how-to-engage-neighbors-with-free-and-unlimited-holiday-business-posts). **Conflict** on the post allowance.
- **2026 change (user-review analysis, not an official source):** Spanish-language reviews point to a rollout to service categories (cleaning, landscaping, trades) in late May–June 2026. English complaints surged in mid-July 2026 and peaked in early August 2026. Personal profiles can no longer mention businesses, even to recommend others. Users are pushed to Business Pages, where commenting on neighbors' requests is paywalled ("it cost 100$ now just to comment on a homeowners request for help"). Reported prices run $80 to $2,000+/mo, apparently tiered by category and geography, with no published rate card. Other complaints: suspensions without stated reasons, and real-name/ID verification after neighbors report an account — [Unstar.app analysis](https://unstar.app/blog/nextdoor-business-paywall-cant-comment-suspended-2026)
- Leadhall says it monitors Nextdoor recommendation requests without logging into your account — [Leadhall](https://leadhall.com/)

### Inferences
- If the paywall applies in Harford County, the cheap Nextdoor tactics are: (1) build up Business Page recommendations from past customers so your page auto-surfaces when neighbors mention you, and (2) treat Nextdoor discovery as read-only intel (seeing who's asking), then reach the homeowner through a legitimate channel only where the rules allow.
- An extension that scrolls the Nextdoor feed is technically possible, but Nextdoor's suspension pattern makes automation on a personal account risky.

### Gaps
- No official Nextdoor Help Center statement on the 2026 business-commenting paywall or its prices was found. Evidence is user reviews only.
- Not confirmed whether the change has reached Maryland / Harford County.
