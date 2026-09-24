# JS Landscaping: group agent

A Chrome extension that does what you were doing by hand: looks through your Facebook groups for neighbours asking for lawn and landscaping work, has the app read the post and write the comment with a tracked link, and posts it.

It runs as you, in your Chrome, on your Facebook account, with your app sign-in. Nothing here logs in anywhere. Close Chrome and it stops.

## Review first

Out of the box it asks before posting. Every comment it writes waits under **Comments to approve** on the Group Agent page (and as a line on My Day) with the post beside it. Change the words if you like, then approve and the browser posts it on its next minute; decline and the post is left alone. The popup shows how many are waiting. Once you trust it, tick **Post without asking me** in the app and it posts as soon as it has written one.

## What it does, once a minute

1. Asks the app whether it is allowed to post right now: the sources, the caps, the hours, and the pause button all live at **app → Link Tracking → Group Agent**.
2. If a comment is waiting and it is due, opens that post in a small window of its own to the right of yours, types an @mention of the person who asked, types the comment, sends it, checks it went up, closes the window, and tells the app. Then waits ninety seconds to five minutes before the next.
3. Otherwise, opens whichever page is most overdue a look, in that same kind of window: your groups feed (every group you're in, on one page), a Facebook post search for one of the phrases set in the app, or a group listed by hand. It reads the first few screens and sends the posts that mention the work to the app. The app throws out anything seen before, reads the rest, writes a comment for each real request, and hands the finished words back to be queued.

The window is drawn on screen because Chrome only loads a Facebook page it is drawing; a hidden tab stays empty. It never takes focus from what you're doing and closes within about ten seconds.

A post found by search in a group you haven't joined can't be answered. The group goes on the **Groups to join** list on the Group Agent page, with a count of the leads seen in it, so you can join the ones that matter. Press "I joined" and its posts get answered from then on.

Everything it does lands on the Link Tracking board exactly like a comment you wrote yourself: the group, the words, the opens, the bookings.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Press **Load unpacked** and choose this `extension` folder.
4. Pin it from the puzzle-piece menu.
5. Sign in to the app in this Chrome, and stay signed in to Facebook.
6. In the app, add the groups to watch and press Save.

The popup shows what it is doing. **Look now** scans every group straight away; **Post the next one now** skips the wait; **Answer this post by hand** is the old button, and opens the app with the post you are looking at.

## Keeping the account safe

- It never posts more than the caps in the app (two an hour and six a day to start), never outside the hours set there, and never twice on one post.
- If Facebook shows anything like "temporarily blocked" or "action blocked", it stops for a day on its own and says so in the app. Do not turn it back on the same day.
- Facebook's terms do not allow automated posting. Running this is a risk to the account it runs on. Keep the caps low, keep the comments honest, and leave **Post without asking me** off if you would rather see each one first.

## Updates

You should rarely need to download this again. Every selector and every wait the extension uses on a Facebook page comes from the app each minute (the "recipe" in `src/lib/outreach-agent-recipe.ts`), so when Facebook moves a button the fix is deployed to the app and every copy has it within a minute. When a change does need new extension code, the popup shows "A newer version is ready" with a download link, and the old copy keeps running until you swap it. To swap: download, unzip, and in `chrome://extensions` either replace the files in the folder you loaded and press the reload arrow, or remove the old one and Load unpacked again.

## If it stops working

If the popup says it could not find the comment box or the comment did not appear, Facebook's page has changed. That is a recipe fix in the app, not a download. Until it is fixed, the written comments are still on the Link Tracking board to paste by hand.
