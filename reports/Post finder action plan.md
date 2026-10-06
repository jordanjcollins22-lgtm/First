# Post finder action plan

*JS Landscaping MD · Oct 6, 2026 · built from the cost report, the Facebook research, and the finder's last 10 days*

**Goal:** more real requests found sooner, answered first and safely, for the lowest running cost.

## Where things stand

| | Now | Problem |
|---|---|---|
| Sorting | **Stopped since 1pm Oct 5** (API credit is empty) | 123 posts waiting, at least one real lead |
| Where it looks | Feed + Facebook search. **Visiting your 9 groups directly is switched off** | The feed gave 1 request in 172 posts; global post search is broken for many accounts since Sept 2025 |
| Reddit | Refused every run (no Reddit app key) | 0 posts, ever |
| Cost | Every post goes to the most expensive model | ~0.4¢ per post sorted, 3–4¢ per comment |
| Answering | One person per post, and comments open with "I work with JS Landscaping" | Good. The disclosure can be edited out, though |
| Results | Nobody records whether a comment turned into a job | We can't tell which groups or replies pay |

---

## Phase 1: Today (settings and accounts only, no code, about 30 minutes)

1. **Add $10–20 Anthropic credit with auto-reload** at console.anthropic.com → Billing. This restarts sorting, and the 123 waiting posts clear within about 30 minutes. *You.*
2. **Turn on "The groups listed below"** in the finder settings (Marketing → Where Posts Come From). Your 9 local groups then get checked one by one, instead of hoping they show up in the feed. *You, or I can switch it on.*
3. **Turn the feed down.** Leave it on, but at a slower interval, until per-group search (Phase 2) is live, then turn it off. *Settings.*
4. **Turn Reddit off for now.** Getting API access now takes a manual approval, and Harford lawn requests on Reddit are rare. Revisit in spring. *Settings.*
5. **Turn on "All posts" notifications** on your phone for your 3 busiest groups (Harford Happenings, Harford County Advice Line, Bel Air: News & Happenings). It's the fastest free alert there is. *You.*

**Effect:** leads start flowing again today, and most of the finder's time moves from junk to your groups.

---

## Phase 2: This week (code changes I can make)

| # | Change | Why | Effect |
|---|---|---|---|
| 1 | **Skip junk before sorting.** Only send posts with a yard word or an asking phrase to the AI | 162 of 163 requests had one; 282 posts had neither | **~35% less sorting cost**, about 1 lead in 160 missed |
| 2 | **Cheaper sorting model.** Test Haiku 4.5 against the 809 posts already sorted; switch if it catches the requests | Sorting is a simple job; Haiku is 5× cheaper | **Up to ~80% less** on what's left |
| 3 | **Keep the better model for writing comments**, moved to the newer Opus 5.5 | The comment is what wins the job; Opus 5.5 is 20% cheaper than today's model | Same quality, less cost |
| 4 | **Search inside each group** ("Most Recent", newest first) with service + asking phrase pairs, replacing global search | Global "Posts" search is gone for many accounts; in-group search still works | More requests found, and found sooner |
| 5 | **Phone alert for hot posts.** Text the person on duty when a request is under 30 minutes old, in your area, with few replies | Replying within the hour is ~7× more effective (HBR) | Faster first reply |
| 6 | **Score every request** and order the board by it: age first, then number of businesses already replying, still looking, service + urgency, town, homeowner vs renter | Old or crowded posts waste the team's time | Team answers the best posts first |
| 7 | **Lock the disclosure.** The comment can't go out without "I work with / I operate JS Landscaping" | The FTC requires the connection in the comment itself; fines up to ~$53k per violation | Removes the biggest legal risk |
| 8 | **Record the outcome** on each answered post: messaged / quoted / booked / nothing | No published data covers this; your own will, after one season | Shows which groups, replies and people win jobs |
| 9 | **Fix the posting timer** (from Nov 1 posts would go out a day late) and **stuck "posting" posts** | From the earlier list | Page posts go out on time |

**Effect:** the cost of sorting falls by roughly **85–90%**, more of the real requests are found, and the best ones reach the team within minutes.

---

## Phase 3: Safer running (keep the account healthy)

- **Read only, never automate comments.** The finder reads; people comment by hand from their own accounts. *(Already the case.)*
- **Slow and steady.** Keep the scan interval at 30–60 minutes per group, and stay inside your 6am–10pm hours. Stop for a day if Facebook ever shows a warning.
- **Store only what's needed:** post text, link, group and time. Never share or sell the data, and never give the extension to other businesses.
- **Join new groups slowly:** 1–2 a day for newer accounts, 4–6 for older ones, never 5 in an hour.
- **Respect each group's rules.** Record each group's rule on business replies (allowed / ask admin / not allowed) and hide posts from "not allowed" groups on the board.
- **No links in the first comment.** Give the phone number; send the booking link in one follow-up DM if they reply.

---

## Phase 4: Grow where the leads are (ongoing)

1. **Find 10–15 more local groups** through Facebook's Groups search, using each town name plus "community", "moms", "buy sell" or "neighbors". Pick active groups with posts every day whose rules allow recommendations.
2. **Grow your own Bel Air group.** As admin you get Facebook's **keyword alerts**, the only built-in alert of its kind. Add groups for Abingdon and Aberdeen once it has a few hundred members.
3. **Ask happy customers to tag you** when neighbors ask. A real customer's recommendation beats any comment from the business.
4. **Nextdoor: business page only.** Since Aug 19, 2026, personal accounts can't promote a business. Treat it as a secondary channel until the rumored paid commenting is confirmed for Harford.
5. **Seasonal focus:** leaf cleanup now through early December, snow bursts before storms, and spring cleanup and mulch from March to May, when requests run 2–4× higher than in winter.

---

## What it should look like after

| | Today | After the plan |
|---|---|---|
| Sorting cost | ~0.4¢ / post | ~0.05¢ / post |
| Daily running cost | ~$1 | **cents a day** + a few cents per comment |
| Where posts come from | Feed junk + global search | Your groups, newest first |
| Time to first reply | Whenever someone looks | Alert within minutes for hot posts |
| Knowing what works | Nothing tracked | Booked jobs per group, per reply, per person |

## Next decisions for you

1. **Credit:** add it today? *(needed for anything to sort)*
2. **Code changes:** OK to make Phase 2 on the live branch (`claude/image-upload-canvas-382r1a`), which updates the real app as soon as it's pushed?
3. **Alerts:** who should get the "hot post" texts, and during what hours?
