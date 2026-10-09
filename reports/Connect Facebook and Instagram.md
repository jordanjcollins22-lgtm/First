# Connect Facebook and Instagram

*JS Landscaping MD · about 15 minutes, once*

You make one Meta app, paste two values into your app, and press **Connect Facebook**. The app does the rest: it gets a key for every page, finds each page's Instagram and switches on DMs. Adding more pages later is one click. You don't touch Vercel or copy any tokens.

**Do it on a computer, signed into the Facebook account that is an admin of the JS Landscaping page.**

---

## Before you start

1. **Instagram must be a Business account linked to the Facebook page.** In the Instagram app: Settings → Account type and tools → Switch to professional → Business. Then Accounts Center → add the JS Landscaping Facebook page.
2. **Have a Meta Business portfolio.** Check at business.facebook.com. If you don't have one, make one called **JS Landscaping MD**.

## Step 1: Create the Meta app (5 minutes)

1. Go to **developers.facebook.com** → **Get Started** if it's your first time.
2. **My Apps** → **Create App** → name it `JS Landscaping System` → use case **Other** → type **Business** → pick **JS Landscaping MD** → **Create app**.
3. Under **Add products**, set up **Messenger**, **Instagram** (pick "API setup with Facebook login"), and **Facebook Login for Business**.

## Step 2: Two settings in Meta (2 minutes)

The admin screen shows both addresses. Click one to copy it.

1. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs:**
   `https://app.jslandscapingmd.com/api/meta/callback` → **Save**.
2. **App settings → Basic → Privacy policy URL:**
   `https://app.jslandscapingmd.com/privacy` → **Save changes**.

## Step 3: Paste it into your app (2 minutes)

1. In Meta, go to **App settings → Basic**. Copy the **App ID**, then click **Show** next to **App secret** and copy it.
2. In your app, open **Admin → Facebook & Instagram → Setup**.
3. Paste both and click **Save**.

> If Meta's Facebook Login for Business screen insists on a **Configuration ID**, create one under Configurations, with the Messenger, Instagram and pages permissions. Paste its ID in the optional box. Otherwise leave that box blank.

## Step 4: Press Connect Facebook (1 minute)

1. Click **Connect Facebook**.
2. On Facebook's screen, choose the **JS Landscaping** page and its Instagram, and **allow every permission**.
3. You come back to the app and it says "Connected 1 page. Messages are switched on."

The first page you connect is automatically set to **Posting**, so the week's approved posts go out from it. The **Pages** tab lets you change what each page is for.

## Step 5: Test it

From your **personal** Facebook, message the JS Landscaping page "test". It shows up in **Admin → Facebook & Instagram → Inbox** within seconds, and you get a text. Reply from there.

---

## Customer DMs: Meta's approval (same as before)

Until Meta approves the app, only people with a role on it (you, and anyone you add under **App roles**) get through.

1. **Verify the business:** business.facebook.com → Settings → Business info → **Start verification**. Upload your LLC articles, EIN letter, or a utility or bank statement. Meta takes 1–5 days.
2. **App Review:** request **Advanced access** for `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` and `instagram_manage_messages`. Each one needs a short screen recording; I'll write the wording when you get there.
3. When approved, switch the app to **Live**.

## Adding more pages later (Post Collector, and others)

Create the page on Facebook. In the app, click **Connect again** on Setup and tick the new page on Facebook's screen. On the **Pages** tab, set what it's for. You don't need a new app or another review.

## Rules to know

- **24-hour window:** you can reply from the app for 24 hours after someone's last message. After that, reply from Facebook or Instagram directly. The inbox tells you when this applies.
- **Personal profiles can't be connected.** Only pages and Instagram business accounts.
- Keys are stored on the server and never shown. If you reset the App secret in Meta, paste the new one in Setup.
