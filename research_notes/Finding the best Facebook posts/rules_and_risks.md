# Rules and Risks: Browser-Extension Feed Reading + Team Commenting on Homeowner Recommendation Posts (US, 2025-2026)

Not legal advice. Research date: 2026-10-06. Confidence levels are noted per section. Practitioner numbers are observations, not published Meta limits.

## 1. Meta Terms of Service and Automated Data Collection Terms: what they prohibit, enforcement, and practical risk for a single-user extension

### Takeaway
Meta's Terms flatly prohibit accessing or collecting data "using automated means" without prior permission, and this applies to logged-in users. A browser extension that reads the user's own logged-in feed is technically within that prohibition even at human pace. The realistic consequence for a small business is account-level enforcement (checkpoints, feature blocks, disablement), not a lawsuit. Meta's lawsuits have targeted companies that scrape commercially at scale or distribute extensions to many users. Confidence: high on the text of the rules, medium on how enforcement plays out in practice.

### Cited Findings
- Meta Terms of Service (effective January 1, 2025): "You may not access or collect data from our Products using automated means (without our prior permission)." Users also may not "do anything else that could disable, overburden, interfere with, or impair the proper working, integrity, operation, or appearance of our services," or use the products in ways that are "misleading" or that assist someone else in doing so. — [Meta Terms of Service](https://www.facebook.com/terms.php)
- Meta Automated Data Collection Terms (effective October 7, 2024) define Automated Data Collection as "collection of data from Meta Company Products via... automated or programmatic tools," including "web scrapers, bots, robots, spiders, crawlers." The terms say "You will not engage in Automated Data Collection without first obtaining Meta's express written permission." They bar transferring, selling or licensing collected data to third parties and bar collecting personal data that is not "Publicly Available Personal Data." Remedies include revoking permission, requiring deletion of collected data, terminating agreements, and indemnification. — [Meta Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)
- Meta v. Bright Data (N.D. Cal., Judge Edward Chen, January 2024): the court granted Bright Data summary judgment on breach of contract. It held that Meta's terms govern "your use" of Meta's products and that "Bright Data did not 'use' Facebook and Instagram when it engaged in public logged-off scraping." It also said the purpose of those terms is "to prevent account holders who have privileges and access to Meta services from abusing their access." Meta then waived its right to appeal. — [Farella Braun + Martel](https://www.fbm.com/post/102kqw7/); [MediaPost: Meta abandons lawsuit](https://www.mediapost.com/publications/article/393996/None)
- Key point from the same ruling: the debate was logged-off versus logged-in scraping. Meta's terms clearly bind logged-in account holders, and the court reasoned that the terms exist to stop account holders from abusing their access. — [Farella Braun + Martel](https://www.fbm.com/post/102kqw7/)
- Browser-extension precedent: in October 2020 Meta sued BrandTotal and Unimania over browser extensions ("UpVoice" and "Ads Feed") that used users' own logged-in access to scrape data such as name, user ID and gender. The cases settled in 2022 with a permanent injunction, deletion of code and data, and a "significant" payment. The court had ruled at summary judgment that BrandTotal did "not violate the CFAA." — [TechCrunch, Oct 2022](https://techcrunch.com/2022/10/03/meta-settles-lawsuit-for-significant-sum-against-businesses-scraping-facebook-and-instagram-data); [Meta newsroom, Oct 2020](https://about.fb.com/news/2020/10/taking-legal-action-against-data-scraping/amp/) (older item, 2020-2022)
- Facebook applies feature limits "to prevent the abuse of our features and to protect people from spam and harassment," based on factors such as speed and quantity. Examples given are temporary blocks on messaging non-friends or on adding many people to a group. The help page does not state how long blocks last. — [Facebook Help Center](https://www.facebook.com/help/177066345680802)
- Practitioner and secondary claims: Facebook flags patterns "inconsistent with typical human interaction." Extensions that manipulate the DOM may be more detectable because client-side monitoring can spot programmatic interactions. Low-quality source (content-farm site), so treat as unverified. — [erpstaging.fha.gov.ng "Facebook Blocked for Going Too Fast"](https://erpstaging.fha.gov.ng/?p=22191)
- One practitioner lists "browser extensions or bots" among the triggers for restrictions. — [Lilach Bullock, 2026](https://www.lilachbullock.com/how-many-facebook-groups-can-you-join-without-getting-flagged/)

### Inferences
- An extension that only reads what the logged-in user's browser already renders is legally lower-risk than Bright Data-style mass scraping. However, it is not ToS-compliant: the Terms bar any automated collection by a logged-in user. The Bright Data reasoning ("account holders who have privileges") makes logged-in automation the clearer breach, not the safer one.
- The biggest legal exposure comes from the following. Each moves the business toward the BrandTotal/Unimania pattern, where Meta sued:
  - distributing the extension to other people
  - storing or selling collected data, especially personal data such as names and profile IDs
  - sending data to a server for aggregation
- For a single business using it internally, the realistic risk is account enforcement: checkpoints, temporary feature blocks, or disablement of the profile. That profile is likely also the account the team uses to comment, so losing it costs both the data source and the outreach channel.
- Ways to lower risk:
  - Read only, with no automated clicking, scrolling or commenting.
  - Have the human scroll and let the extension passively parse what is on screen, rather than auto-scrolling.
  - Keep data minimal: post text and URL rather than commenters' personal profiles. Do not resell or share it.
  - Never automate posting comments. Automated engagement falls under Meta's spam policy ("engaging with content... at very high frequencies").
- Meta's official route is its API. Meta's Groups API was deprecated in 2024 (background knowledge, not verified this session), so there is effectively no sanctioned way for a small business to read group feeds programmatically.

### Gaps
- No public source found on whether Meta actively fingerprints specific read-only extensions in 2025-2026, or on enforcement rates against single-user extensions.
- hiQ v. LinkedIn was not fetched this session. From background knowledge (unverified here): the 9th Circuit (2022) held that scraping public data likely is not "without authorization" under the CFAA. A later district ruling (late 2022) found hiQ breached LinkedIn's User Agreement, including through logged-in fake accounts, and the case settled. Verify before citing.
- The exact date of the Bright Data order (reported as January 23, 2024) was not confirmed on a primary court document.

## 2. Behaviours that trigger Facebook spam and automation detection, and practitioner "safe limits"

### Takeaway
Meta publishes no fixed limits. Enforcement is based on velocity and patterns, and it tightens when other spam signals are present. The highest-risk behaviours are:
- many actions in a short burst
- identical or copy-paste comments
- many group joins
- links
- new or thin accounts

Practitioner guidance is roughly 1–2 group joins a day for new accounts and 4–6 a day for aged accounts. Confidence: high on the categories of behaviour, low to medium on any specific numbers.

### Cited Findings
- Meta Spam Community Standard (last updated June 27, 2024) prohibits:
  - "Posting, sharing, engaging with content or creating accounts, Groups, Pages, Events or other assets... at very high frequencies"
  - Enforcement at lower frequencies "with other spam indicators present"
  - Misleading links and redirects, fake engagement, and content designed "to deceive, mislead, or overwhelm users"

  — [Meta Transparency Center: Spam](https://transparency.meta.com/policies/community-standards/spam/)
- Facebook "limits how often you can post, comment or do other things in a given amount of time in order to help protect the community from spam." For high-volume activity, spam and velocity filters "often impose restrictions long before" the Graph API's 4,800 actions per 24 hours. (That API figure applies to Page management, not personal profiles.) — [ConversionIQ blog](https://conversioniq.ai/blog/what-is-the-daily-comment-limit-on-facebook)
- Practitioner limits for group joins (Lilach Bullock, 2026). The author stresses "there isn't one fixed number":
  - New accounts (under 30 days, fewer than 50 friends): "1 to 2 group joins a day, maximum"
  - Established profiles (1+ years, 200+ friends): "4 to 6 a day is comfortable"
  - Well-aged accounts: up to 8
  - Never more than 5 joins in an hour
  - Business or admin profiles should be treated like new accounts

  — [Lilach Bullock](https://www.lilachbullock.com/how-many-facebook-groups-can-you-join-without-getting-flagged/)
- Triggers named by the same source:
  - joining "ten groups inside twenty minutes"
  - "identical answers pasted into every membership question box"
  - new profiles with no photo, bio or history joining aggressively
  - joining thematically unrelated groups
  - browser extensions or bots

  First blocks typically last "24 to 48 hours" and repeat offences about a week or longer. — [Lilach Bullock](https://www.lilachbullock.com/how-many-facebook-groups-can-you-join-without-getting-flagged/)
- Another secondary source: joining more than 5–8 groups a day on a normal profile raises block risk, and new accounts should stay under 3 a day for the first month. Repeat blocks can extend to about 10 days. Low-quality source. — [erpstaging.fha.gov.ng](https://erpstaging.fha.gov.ng/?p=22191)
- Meta's automated spam detection "flags rapid posting of identical content across multiple groups within short timeframes, regardless of quality." Admin keyword filters hold posts containing phrases like "DM me" or "sale," and enough member reports can remove content automatically. — [Lilach Bullock: stop groups removing business posts](https://www.lilachbullock.com/stop-facebook-groups-removing-business-posts/)

### Inferences
- For team commenting:
  - Write a unique, specific reply to each post. Do not reuse templates, and vary phrasing even when the answer is the same.
  - Space comments out. Practitioner guidance is a handful per hour per person, not bursts.
  - Avoid links in first comments. Phone numbers and bare business names are less spam-like than URLs, though some group rules ban those too.
  - Use real, aged personal profiles with photos and history.
- Several team members posting near-identical recommendations of the same business across many groups resembles coordinated inauthentic behaviour as well as spam. Varied wording and genuine first-person context reduce the risk.
- Plan for a temporary comment or join block as a normal, recoverable event (24–48 hours). Stop activity when it happens rather than retrying, since repeat offences escalate.

### Gaps
- I found no credible, specific published numbers for safe comments per hour or day on personal profiles. All figures found are anecdotal or derived from the Page API.
- I found no 2025-2026 source on whether Meta treats comments containing phone numbers differently from links.

## 3. Group rules: "no business promotion," how admins treat business replies to recommendation requests, and how to stay welcome

### Takeaway
Many local groups ban self-promotion outright or limit it to designated threads or days. Admins enforce through membership-question agreements, keyword filters and removals or bans. The safest posture combines:
- being a genuine local member who contributes
- answering only when asked
- disclosing the business connection
- clarifying policy with admins
- using paid or sponsored options where offered

Confidence: medium. The evidence comes from practitioner blogs; rules vary by group.

### Cited Findings
- Many groups now limit self-promotion. Groups often hide a rule in a membership question, such as "Have you read our no self-promotion policy? Type YES to confirm," which admins treat as binding even if it is absent from the formal rules list. "A surprising number of groups ban promotional posts entirely," and some groups remove users entirely for spam. — [Lilach Bullock: group rules before you post](https://www.lilachbullock.com/facebook-group-rules-before-you-post/) (via search summary)
- Recommended practices:
  - read the rules
  - slow posting velocity
  - put links in comments rather than post text
  - avoid trigger phrases ("limited time," "click here")
  - contribute three times before promoting once
  - check for shadow restrictions
  - "Message admins directly about their promotion policy"
  - "contribute for two weeks minimum before you sell anything"

  The same source warns that "a Facebook group you don't own is borrowed audience." — [Lilach Bullock](https://www.lilachbullock.com/stop-facebook-groups-removing-business-posts/)
- Suggested contribution pattern: answer questions in other people's threads "three or four times a week with zero promotion," with roughly 80% helpful content and 20% promotional, including recommending other businesses. — [Lilach Bullock, via search summary](https://www.lilachbullock.com/stop-facebook-groups-removing-business-posts/)
- Example of the local-business pattern: "a plumber joins home renovation groups." — [Groupboss: Local Facebook Groups](https://groupboss.io/blog/local-facebook-groups/amp/)

### Inferences
- A homeowner's request ("Can anyone recommend a roofer?") is the context where a business reply is most tolerated. Many groups still require business owners to identify themselves, or allow only "tag a business" responses. A disclosed reply such as "I own X, happy to help, here's our number" is generally better received than an employee posing as a satisfied customer. Disclosure is also legally required (see section 5).
- Common admin rules to check: designated "business promo" days or threads, "no self-tagging," "recommendations from customers only," and no links. Some local groups sell sponsorships or "preferred vendor" posts. Asking an admin directly is the cleanest path.
- Team members should join only groups where they actually live or work. Out-of-area members answering "local" requests are a common reason for removal.

### Gaps
- I found no systematic survey of how often local or homeowner groups ban business replies to recommendation requests, or of typical sponsorship prices.
- I could not verify Facebook's current admin tools (Admin Assist auto-decline of links, keyword alerts) from Meta's own help pages in this session.

## 4. Nextdoor and Reddit rules for businesses answering requests, including Reddit API terms for small apps

### Takeaway
Nextdoor's policy (updated August 2026) requires businesses to promote themselves from a free Business Page, not personal accounts, in posts, comments and DMs. Neighbors may still recommend businesses. Reddit tolerates self-promotion only from genuine participants, roughly a "10%" norm, and subreddit rules vary. Since November 2025, any new Reddit API access requires manual approval under the Responsible Builder Policy. Confidence: high for the Nextdoor and Reddit API facts, medium for Reddit norms because the sources are secondary.

### Cited Findings
- Nextdoor's self-promotion update (blog dated August 19, 2026):
  - "promoting a business, service, or paid opportunity must be done from a free Business Page, not a personal neighbor account." This covers posts, comments in the main feed and direct messages.
  - "Businesses succeed on Nextdoor when neighbors promote them, not when they promote themselves."
  - Recommendations and asking for referrals remain welcome from personal accounts.
  - Casual occasional offers (babysitting and similar) are allowed about once a month.
  - Nextdoor Groups set their own promotion rules.
  - Enforcement looks at patterns. Flagged content stays visible but reaches fewer people, with an email and banner notice and an option to appeal.
  - Business Posts are free each month for verified businesses.

  — [Nextdoor blog: self-promotion update](https://blog.nextdoor.com/self-promotion-update)
- Reddit Content Policy Rule 2: "post authentic content into communities where you have a personal interest, and do not cheat or engage in content manipulation (including spamming...)." Reddiquette spirit: "it's fine to be a redditor with a website, it's not fine to be a website with a Reddit account." The roughly 10% self-promotion guideline is cited, and subreddit moderators set their own rules. — [Redship guide, 2026 (secondary)](https://redship.io/blog/reddit-self-promotion-rules-2026)
- Unverified claim from the same secondary source: in 2025 Reddit "wiped out roughly 70% of automated posting accounts." — [Redship](https://redship.io/blog/reddit-self-promotion-rules-2026)
- Reddit Responsible Builder Policy (announced November 2025):
  - Self-service access to the public data API closed.
  - Developers, mods and researchers must request approval for new OAuth tokens through the Developer Support form.
  - Reddit is aiming for about a 7-day turnaround.
  - Existing compliant access was not affected.

  — [r/redditdev announcement (mirror)](https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/noeamby); [Data365 summary](https://data365.co/blog/reddit-oauth-api-documentation)

### Inferences
- On Nextdoor, team members answering as residents ("I used X and they were great") is permitted only if they are genuine neighbors and customers, and they would still need to disclose employment. Promotional replies should come from the Business Page.
- A small tool that monitors Reddit should now apply for API approval rather than scrape. Scraping Reddit would conflict with its terms; the user agreement was not fetched this session.

### Gaps
- reddit.com could not be fetched directly. The reddiquette and 10% wording comes from secondary sources. Reddit's current user agreement language on scraping was not verified.
- I did not find whether Nextdoor's policy explicitly addresses employees (as opposed to owners) recommending their employer from personal accounts.

## 5. FTC disclosure concerns: employees or affiliates recommending the business without disclosing

### Takeaway
Employees, owners, relatives and paid affiliates who recommend the business in groups must clearly and conspicuously disclose the connection in the comment itself. A profile listing is not enough. The business is expected to train and monitor them. Since October 21, 2024, the Consumer Reviews and Testimonials Rule (16 CFR Part 465) also enables civil penalties of up to $53,088 per violation for undisclosed insider reviews and testimonials, and the FTC issued warning letters in late 2025. Confidence: high.

### Cited Findings
- FTC Endorsement Guides FAQs:
  - Employees mentioning company products should disclose the relationship.
  - Listing employment on a profile page is insufficient because "people who just read what you post won't get that information."
  - On review sites, employees "definitely should disclose your employment relationship."
  - Companies must train network members, periodically search for what they say, and act on non-compliance. They are not expected to see every statement but must make a "reasonable effort."

  — [FTC: Endorsement Guides FAQs](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides)
- 16 CFR 255.5, Example 8: an employee promoting the employer's product on an online enthusiast message board without disclosure. Knowing about the employment "would likely affect the weight or credibility," so the employee must disclose clearly and conspicuously. The duty applies even on sites the employer does not run. The 2023 revision kept this example, updated to a robotics enthusiast community. An employment relationship is a "material connection." — [Frankfurt Kurnit (FKKS)](https://advertisinglaw.fkks.com/post/102hpsb/part-v-ftcs-proposed-revisions-to-the-endorsement-guides-disclosure-of-mater); [Mondaq: 2023 updates](https://www.mondaq.com/unitedstates/consumer-law/1349688/an-in-depth-look-at-the-ftcs-updates-to-the-endorsement-guidespart-2-of-2)
- Consumer Reviews and Testimonials Rule (16 CFR Part 465):
  - Final rule announced August 14, 2024, effective October 21, 2024.
  - Prohibits reviews or testimonials by officers or managers without clear and conspicuous disclosure.
  - Prohibits a business from disseminating testimonials it should have known came from officers, managers, employees or agents without disclosure.
  - Regulates soliciting reviews from employees and relatives.
  - Civil penalties up to $53,088 per violation.

  — [Benesch (April 2026)](https://www.beneschlaw.com/insight/five-stars-zero-tolerance-ftc-turns-up-enforcement-under-consumer-review-rule/); [Olshan](https://olshanlaw.com/Advertising-Law-Blog/FTC-Publishes-New-Rule-Covering-Fake-Reviews-and-Testimonials)
- Enforcement: the FTC sent warning letters to "nearly a dozen companies in late 2025," with enforcement intensifying after an initial education period. Recipients had five business days to respond. Undisclosed insider reviews are one of six focus areas. — [Benesch, April 6, 2026](https://www.beneschlaw.com/insight/five-stars-zero-tolerance-ftc-turns-up-enforcement-under-consumer-review-rule/)

### Inferences
- A team member answering "Can anyone recommend a painter?" with "Use ABC Painting, they're great" without saying "I work there" is the textbook undisclosed-employee endorsement. Simple in-comment disclosures fix it, for example "I'm the owner of…" or "Full disclosure: I work for…"
- Whether a group comment counts as a "testimonial" under Part 465, as opposed to an endorsement under the Part 255 Guides, is a legal question. The Guides alone support FTC Act Section 5 enforcement. Part 465 adds per-violation penalties for clear-cut insider reviews.
- The business should keep a written social-media disclosure policy, train staff, and spot-check comments. That matches the FTC's "reasonable effort" monitoring expectation.

### Gaps
- No FTC action specifically about Facebook group comments by small local service businesses was found. Enforcement examples are mostly larger companies.
- The penalty amount is inflation-adjusted annually. The 2026 figure may differ slightly from $53,088. Verify.
