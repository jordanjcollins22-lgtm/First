import type { Metadata } from "next";

import { isSupabaseConfigured } from "@/lib/env";
import { careersOrg } from "@/lib/data/hiring";

/**
 * The privacy policy. Public, because Meta reads it before an app may connect
 * a page, and because anybody who messages the business is owed it.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Privacy policy" };

export default async function PrivacyPage() {
  const org = isSupabaseConfigured ? await careersOrg(undefined).catch(() => null) : null;
  const name = org?.name ?? "We";

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p className="text-muted-foreground">Last updated 9 October 2026</p>

      <p>
        {name === "We" ? "We" : `${name} ("we")`} run this site and app to book, quote and carry out landscaping work. This
        page says what we keep about you, why, and how to have it removed.
      </p>

      <h2 className="pt-2 text-lg font-semibold">What we keep</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>What you give us when you book, ask for a quote or become a client: your name, address, phone, email and the details of the work.</li>
        <li>
          Messages you send our Facebook page or Instagram account, with the name those services show us. We keep them so
          we can answer you and see the conversation later.
        </li>
        <li>Photos of the work at your property, taken by our crew.</li>
        <li>Payments, handled by our payment processor. We never see or keep your full card number.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">What we do with it</h2>
      <p>
        We use it only to answer you, book and do the work, send the reminders and invoices that go with it, and keep
        our records. We do not sell it, and we do not share it except with the services that run this app for us
        (hosting, text messages, email, payments) and, where you ask for work we arrange through a partner, that partner.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Facebook and Instagram</h2>
      <p>
        When you message our page or Instagram account, Meta passes us the message, your name and an ID for the
        conversation. We use them only to reply to you. We do not read anything else from your account.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Removing your information</h2>
      <p>
        Ask us by message on our Facebook page or Instagram, by text, or by email, and we will delete what we hold about
        you within 30 days, except what the law requires us to keep (invoices and tax records). Texting STOP to any
        number we text from stops texts at once.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Changes</h2>
      <p>If this changes, the date at the top will change with it.</p>
    </main>
  );
}
