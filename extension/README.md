# JS Landscaping: group agent

A Chrome extension that does what you were doing by hand: looks through your Facebook groups for neighbours asking for lawn and landscaping work, has the app read the post and write the comment with a tracked link, and posts it.

It runs as you, in your Chrome, on your Facebook account, with your app sign-in. Nothing here logs in anywhere. Close Chrome and it stops.

## What it does, once a minute

1. Asks the app whether it is allowed to post right now: the groups, the caps, the hours, and the pause button all live at **app → Link Tracking → Group agent**.
2. If a comment is waiting and it is due, opens that post in a background tab, types the comment, sends it, checks it went up, closes the tab, and tells the app. Then waits ninety seconds to five minutes before the next.
3. Otherwise, if a group has not been looked at lately, opens it in a background tab, reads the first few screens, and sends the posts that mention the work to the app. The app throws out anything seen before, reads the rest, writes a comment for each real request, and hands the finished words back to be queued.

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
- Facebook's terms do not allow automated posting. Running this is a risk to the account it runs on. Keep the caps low, keep the comments honest, and turn **Post the comments itself** off in the app if you would rather it only found and wrote them.

## If it stops working

Facebook changes its pages. If the popup says it could not find the comment box or the comment did not appear, the page has changed and the two page functions at the bottom of `background.js` (`scanPosts` and `postComment`) need updating. Until then, turn **Post the comments itself** off and paste from the board.
