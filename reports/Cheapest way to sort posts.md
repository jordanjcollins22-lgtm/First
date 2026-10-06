# Cheapest way to sort posts

*JS Landscaping MD · Oct 6, 2026 · based on the last 10 days of the post finder*

## Does the price change with volume?

No. Anthropic charges a fixed price per word (per "token") in and out. There is no volume discount, no monthly minimum, and sorting 123 posts at once costs the same as sorting them 30 at a time. The only official discounts are:

- **Batch mode: 50% off** everything, in exchange for answers arriving within minutes to an hour instead of seconds.
- **Caching: about 90% off** the instructions that are sent again with every call.

So the cost is set by **how many posts get sent**, **which model reads them**, and **how they're sent**, not by when or in what size they're sorted.

## What the finder did in the last 10 days

| | Posts |
|---|---|
| Posts read | 932 |
| Sorted as **asking for work** | 163 |
| Sorted as **business ads** | 342 |
| Sorted as **neither** | 304 |
| From your personal home feed | 172, of which **1** was a request |
| Comments written for the team | 80 answered |

## What it costs today (estimate)

The app uses **Claude Opus 5** ($5 per million words in, $25 out) with thinking switched on, for both sorting and writing comments.

| Job | Rough cost |
|---|---|
| Sorting | about **0.4¢ per post**, so ~$3.70 for the 932 |
| Writing a comment for a request | about **3–4¢ each**, so ~$5–6 for the 163 |
| **Total** | **about $1 a day**, more on catch-up days like Oct 5 |

These are estimates from post length and batch size. The **Usage** page at console.anthropic.com shows the exact figures.

## Ways to cut it, cheapest first

### 1. Don't send obvious junk (saves ~35% of sorting, no real loss)
In the 10 days, **162 of 163 requests** mentioned a yard word (lawn, mulch, leaves, snow, tree…) or an asking phrase ("anyone know", "recommend", "looking for"). **282 posts had neither**: "People you may know", news, car groups, swap posts. Skipping those before sorting:

- cuts about 35% of what's sent;
- would have missed **1 request in 163** (0.6%).

The home feed is the worst offender: 172 posts gave 1 request. Reading it less often (or not at all) saves money *and* frees the finder for your groups.

*Trade-off:* fewer business ads get kept for your competitor list. 99 of the 342 ads had no yard words, mostly non-landscaping businesses you don't need anyway.

### 2. Use a cheaper model for sorting (saves 20–80%)
Sorting "request / ad / neither" is a simple job.

| Model | Price vs today | Risk |
|---|---|---|
| Claude Opus 5.5 (newer) | **20% cheaper** ($4/$20) | None: newer and at least as good |
| Claude Sonnet 5.5 | **60% cheaper** ($2/$10) | Low |
| Claude Haiku 4.5 | **80% cheaper** ($1/$5) | Smallest model: test first |

The 809 posts Opus already sorted are a ready-made answer key. I'd run the cheaper model over them and only switch if it agrees on the requests. Keep the better model for **writing comments**, since a good comment is what wins the job.

### 3. Batch mode (another 50% off)
Send the sort through Anthropic's batch queue. Leads would reach the board **minutes to an hour later** instead of right away. Since speed matters on these posts, use it only for the ads and "neither" pile, or for overnight catch-up.

### 4. Cache the instructions (small saving)
The same instructions go out with every batch. Marking them as cached makes repeats about 90% cheaper.

## Recommended plan

| Step | Saving | Leads lost |
|---|---|---|
| Skip junk before sorting | ~35% | ~1 in 160 |
| Sort with Haiku 4.5 (if it passes the test) | ~80% of what's left | test first |
| Keep a better model for comments | — | — |
| Cache the instructions | small | none |

**Result: sorting drops from ~0.4¢ to well under 0.1¢ a post, roughly a 90% cut.** The whole system would likely run for **cents a day, plus a few cents per comment written**. A $10–20 top-up with auto-reload set low would last a long time.

## Right now

Sorting has been stopped since 1pm Oct 5 because the credit balance is empty. **123 posts are waiting**, including at least one real lead (tree removal, Harford Happenings). Waiting doesn't make the sort cheaper; it only makes the leads older.
