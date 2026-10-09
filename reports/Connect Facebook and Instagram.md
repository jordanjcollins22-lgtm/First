# Connect Facebook and Instagram

*JS Landscaping MD · step-by-step · about 30–40 minutes, once*

This sets up your own Meta app: a free key that lets your app post to your JS Landscaping Facebook page, and read and answer the page's Messenger and Instagram DMs. Nobody downloads anything, and there's no code to write. You click through Meta's settings and copy four values into Vercel.

**Do it on a computer, signed into the Facebook account that is an admin of the JS Landscaping page.**

---

## What it unlocks, and when

| | Works | Notes |
|---|---|---|
| Auto-posting to your business page | **Same day** | The week's approved posts go out on their own at 10am |
| DMs from **you and anyone you add to the app** | **Same day** | Good for testing |
| DMs from **customers** (anyone) | **After Meta approves the app** | Business verification and App Review, usually a few days to 2 weeks. Steps 9–10 |

---

## Before you start (5 minutes)

1. **Instagram must be a Business account linked to the Facebook page.**
   - Instagram app → your profile → ☰ → **Settings** → **Account type and tools** → **Switch to professional account** → **Business**.
   - Then **Settings** → **Accounts Center** → **Accounts** → **Add accounts** → add the JS Landscaping Facebook page.
2. **Have a Meta Business portfolio.** Check at **business.facebook.com**. If you've run ads or used GoHighLevel with your page, you likely already have one. If not, it'll offer to make one; use **JS Landscaping MD**.

---

## Step 1: Become a Meta developer (2 minutes)

1. Go to **developers.facebook.com**.
2. Click **Get Started** (top right). Accept the terms and verify your phone or email if asked.
3. For "Which of the following best describes you?", pick **Developer** (or anything; it doesn't matter).

## Step 2: Create the app (3 minutes)

1. Click **My Apps** → **Create App**.
2. **App name:** `JS Landscaping System`. **Contact email:** jordanjcollins22@gmail.com. Click **Next**.
3. **Use case:** choose **Other** → **Next**.
4. **App type:** choose **Business** → **Next**.
5. **Business portfolio:** pick **JS Landscaping MD** → **Create app**. Enter your Facebook password if asked.

You'll land on the app's **Dashboard**.

## Step 3: Add Messenger and Instagram (3 minutes)

1. On the Dashboard, find **Add products to your app**.
2. Find **Messenger** → click **Set up**.
3. Go back to **Add products** → find **Instagram** → **Set up**. If it offers "API setup with Facebook login" and "with Instagram login", pick **Facebook login**.

## Step 4: Connect your page and copy the page token (5 minutes)

1. Left menu: **Messenger** → **Messenger API Settings**.
2. Under **Generate access tokens**, click **Connect** (or **Add or remove Pages**).
3. Select the **JS Landscaping** page (and its Instagram if shown). Allow **every** permission it asks for → **Done**.
4. Next to the page, click **Generate** → tick "I understand" → **Copy** the token.
   → 📋 **Value 1: `FACEBOOK_PAGE_ACCESS_TOKEN`**. Paste it somewhere safe for now. Treat it like a password.
5. The page's **ID number** is shown next to its name.
   → 📋 **Value 2: `FACEBOOK_PAGE_ID`**

## Step 5: Copy the app secret (1 minute)

1. Left menu: **App settings** → **Basic**.
2. Next to **App secret**, click **Show** → enter your password → **copy** it.
   → 📋 **Value 3: `META_APP_SECRET`**
3. Further down, under **Privacy policy URL**, paste: `https://app.jslandscapingmd.com/privacy` and **Save changes**. (Meta needs one. Tell me if that page doesn't load and I'll add it.)

## Step 6: Put the values in Vercel (5 minutes)

1. **vercel.com** → project **first** → **Settings** → **Environment Variables**.
2. Add each of these with Environment set to **Production**:

   | Name | Value |
   |---|---|
   | `FACEBOOK_PAGE_ACCESS_TOKEN` | Value 1 |
   | `FACEBOOK_PAGE_ID` | Value 2 |
   | `META_APP_SECRET` | Value 3 |
   | `META_VERIFY_TOKEN` | `jsl-8f59e7d9b00e351850bd41ea2929fff3` |

3. **Deployments** → the top (latest) one → **⋯** → **Redeploy**.

**Auto-posting to your page now works.** Approved posts in Marketing → Content go out at 10am.

## Step 7: Turn on the DM connection (3 minutes, after I tell you it's built)

> ⏸ **Wait for my "the webhook is live" message before this step.** Meta checks the address the moment you save it.

1. Back in Meta: **Messenger** → **Messenger API Settings** → **Configure webhooks**.
2. **Callback URL:** `https://app.jslandscapingmd.com/api/webhooks/meta`
3. **Verify token:** `jsl-8f59e7d9b00e351850bd41ea2929fff3`
4. Click **Verify and save**.
5. Next to your page, click **Add subscriptions** → tick **messages**, **messaging_postbacks**, **message_reads** → **Save**.
6. Do the same under **Instagram** → **API setup** → **Configure webhooks** (same URL and token), and subscribe to **messages**.

## Step 8: Test it (2 minutes)

From your **personal** Facebook, message the JS Landscaping page "test". It should appear in the app's DM inbox within seconds. Do the same on Instagram.

Customers' messages won't come through until Meta approves the app (steps 9–10). Until then, only people with a role on the app (you, plus anyone you add under **App roles** → **Roles**) get through.

## Step 9: Verify your business (10 minutes of your time; Meta takes 1–5 days)

1. **business.facebook.com** → **Settings** → **Business info** (or **Security Center**) → **Start verification**.
2. Enter the business's legal name, address and phone exactly as on your paperwork.
3. Upload one document: your **LLC articles**, **EIN letter**, or a **utility bill or bank statement** in the business name.
4. Confirm by the email, phone or domain method it offers.

## Step 10: Ask Meta for customer DMs (App Review) (20 minutes; Meta takes a few days to 2 weeks)

> I'll write the exact wording and make the screen recording guide for this when you get here. It goes smoother with them.

1. In the app: **App Review** → **Permissions and features**.
2. Request **Advanced access** for:
   - `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
   - `instagram_basic`, `instagram_manage_messages`
3. For each one, Meta asks how you use it, plus a short **screen recording** (a customer messages the page, the reply goes out from the app).
4. **Submit.** When it's approved, switch the app to **Live** (toggle at the top of the app page). Customer DMs then flow in.

---

## Where we end up

- Approved posts go to your **Facebook page** on their own.
- Page and Instagram DMs land in **one inbox in your app**, with a reply drafted for you to send.
- Later, adding **Post Collector** takes about 5 minutes: create the page, connect it in Step 4, and add affiliates as **Testers**. No new app, and no review wait, because testers are allowed straight away.

## Rules to know

- **24-hour window:** you can reply freely for 24 hours after a customer's last message. After that, Facebook only allows limited follow-ups.
- **Never share the page token or app secret.** If one leaks, regenerate it in Meta and update Vercel.
- **Your personal profile's DMs can't be connected.** Only the page and Instagram business account.
