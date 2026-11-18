# JS Landscaping: lead finder

A Chrome extension that finds recent Facebook posts from neighbors in Harford County asking for yard work, and gets a comment with your tracked link in front of them. You press post on every comment yourself. It also schedules approved before-and-after posts on the business page.

## What you see

Press the extension's button and a side panel opens next to Facebook. Press **Start finding leads**. In your Facebook tab, it:

1. Reads your groups feed, or searches Facebook for recent posts ("landscaper Bel Air", "leaf removal Bel Air" and the rest of the list in Settings). A pointer moves over each post and outlines it blue while it reads it.
2. Skips ads, posts outside Harford County, posts older than 3 days, and posts it has already seen. Posts that pass the keyword check are read by the app to make sure it's a neighbor asking, not a business advertising.
3. On a lead, scrolls to it, outlines it green, opens the comment box and types the comment where you can watch.
4. Stops and waits for you. Read it, change anything, press **Enter** to post it, or press **Skip** in the panel. When you post, it goes into your **People you sent it to** in the app, with its own tracked link.

**Feed vs search:** it tries both, counts leads per hour for each, and then spends about 4 looks in 5 on whichever finds more. The panel shows both numbers.

## The comment

Same wording rules as the affiliate "Posted asking for help" message: says who you are by role ("I'm the owner of JS Landscaping MD"), answers the post instead of saying you saw it, never promises "free", and carries your tracked link. One paragraph, because Enter posts a comment on Facebook.

## Keeping the account safe

- You press post. It never posts, likes, shares or messages on its own.
- At most 8 comments a day and 6 minutes apart to start (Settings).
- If Facebook ever shows "temporarily blocked", "action blocked" or similar, it stops for 24 hours on its own.
- Never comments twice on one post.

## Posts tab (owner)

Before-and-after drafts waiting for an OK. Tick **the before-and-after looks good** and **the caption looks good** (edit it if you like), then Approve. Each time you press Start, every approved post is scheduled on the next open day (one post a day, at the best-time slot for that weekday, else 10 AM) through Meta's own scheduling on the business page. They show up in Meta Business Suite's Planner. A caption that says "free" can't be approved.

The first time, connect the Facebook page in the Posts tab: make a Meta app, paste its App ID and secret, press Connect.

## Install

1. Unzip it (or use the folder), open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** and choose this folder. Pin it from the puzzle-piece menu.
3. Stay signed in to app.jslandscapingmd.com and to Facebook in this Chrome.
