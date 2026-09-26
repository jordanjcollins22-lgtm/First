# JS Landscaping: post finder

A Chrome extension that finds the posts; the team answers them. It reads your Facebook groups feed, a Facebook search for the phrases set in the app, and any groups listed there, and sends every post it reads to the app. The app sorts each one into somebody asking for work, somebody advertising, or neither. The people asking for work go on the **Posts to answer** board (app → Marketing → Posts to Answer), and the businesses advertising go on the Businesses list for subcontracting.

It never comments, likes, shares or messages. One account answering every lead in the county is what gets an account banned, so the answering is shared out: each person takes a post off the board, gets a comment written for them with their own tracked link, and posts it from their own Facebook. The only thing the finder presses on Facebook is a post's Share → **Copy link**, to bring back a link for a post the page showed without one. It never presses Share now.

It runs as you, in your Chrome, on your Facebook account, with your app sign-in. Nothing here logs in anywhere. Close Chrome and it stops.

## What it does

Press **Turn on** in the popup (or Resume on **app → Marketing → Where Posts Come From**) and it opens one window of its own, to the right of yours, and keeps it open.

1. Once a minute it asks the app whether it is still on, then scrolls further down the page in that window and sends every post it read to the app. The app keeps the new ones and sorts them. The same post is never sent twice.
2. After about ten minutes on your groups feed it moves on to a search or a listed group for a few minutes, then back to the top of the feed for whatever is new.
3. When more posts are waiting for the team than last time, it shows a notification; click it to open the board.
4. When the app lists one of the business's own review pages as due (a Facebook page or a Google Maps listing, set on **app → Marketing → Booking Page**), it reads those reviews in a separate small window, and the app keeps only the five-star ones with something written. This happens even while the finder is off, because the owner asked for it, and again every week.

Press **Turn off** and the window closes. Outside the looking hours set in the app, the window closes too and opens again when they start. If you close the window yourself while it is on, it opens again within a minute; use Turn off to stop it.

The window has to stay on screen, not minimized: Chrome only loads a Facebook page it is drawing. It never takes focus from what you're doing.

A post found by search in a group you haven't joined still goes on the board. The group also goes on the **Groups to join** list on the Where Posts Come From page, with a count of the leads seen in it.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Press **Load unpacked** and choose this folder (unzipped from the download on Where Posts Come From).
4. Pin it from the puzzle-piece menu.
5. Sign in to the app in this Chrome, and stay signed in to Facebook.
6. In the app, check where it looks (app → Marketing → Where Posts Come From) and press Save.

The popup has the **Turn on / Turn off** switch, shows what it is doing and how many posts are waiting for the team. **Look somewhere else now** moves the window on to the next place to look; **Answer this post by hand** opens the app with the post you are looking at.

## Keeping the account safe

- It never posts more than the caps in the app (two an hour and six a day to start), never outside the hours set there, and never twice on one post.
- If Facebook shows anything like "temporarily blocked" or "action blocked", it stops for a day on its own and says so in the app. Do not turn it back on the same day.
- Facebook's terms do not allow automated posting. Running this is a risk to the account it runs on. Keep the caps low, keep the comments honest, and leave **Post without asking me** off if you would rather see each one first.

## Updates

You should rarely need to download this again. Every selector and every wait the extension uses on a Facebook page comes from the app each minute (the "recipe" in `src/lib/outreach-agent-recipe.ts`), so when Facebook moves a button the fix is deployed to the app and every copy has it within a minute. When a change does need new extension code, the popup shows "A newer version is ready" with a download link, and the old copy keeps running until you swap it. To swap: download, unzip, and in `chrome://extensions` either replace the files in the folder you loaded and press the reload arrow, or remove the old one and Load unpacked again.

## If it stops finding posts

Where Posts Come From shows its last look: how many posts it read and what the page looked like. A look that reads nothing means Facebook's page has changed. That is a recipe fix in the app, not a download.
