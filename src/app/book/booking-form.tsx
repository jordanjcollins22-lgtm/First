"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { BookingWizard } from "@/components/booking/booking-wizard";

import type { BookingOptions } from "./booking-options";

/**
 * The booking form, and the wait before it.
 *
 * The page around this is prerendered and comes off the CDN, which is only
 * possible if nothing above this point reads the query string or the
 * database. So the ?ref= / ?org= in the link is read here, in the browser,
 * and the answer is fetched from /book/options.
 *
 * The cost is one round trip after the page paints, spent showing the shape
 * of the form rather than an empty screen. The benefit is that the first
 * paint no longer waits on four Supabase queries — which, for somebody who
 * has just tapped a link in a text message while standing outside, is the
 * whole difference between a form and a white page.
 */

/**
 * The chrome the wizard draws around itself, with nothing in it yet.
 *
 * It is the same wrapper, heading block and five-step bar, so the form does
 * not jump when the real thing replaces it. This is what gets baked into the
 * prerendered HTML.
 */
export function BookingFormSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10" aria-hidden>
      <div className="flex flex-col gap-2">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div className="h-1.5 w-full rounded-full bg-muted" />
            <div className="h-2 w-10 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function Message({ heading, detail }: { heading: string; detail?: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-lg font-semibold">{heading}</p>
      {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function BookingForm() {
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");
  const org = searchParams.get("org");

  // The answer is stored with the link it was fetched for rather than being
  // cleared when the link changes. Clearing would mean writing state during
  // the effect that starts the next fetch; comparing here means a stale
  // answer simply stops being the current one.
  const link = `${ref ?? ""}|${org ?? ""}`;
  const [fetched, setFetched] = useState<{ link: string; result: BookingOptions | "failed" } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (ref) query.set("ref", ref);
    if (org) query.set("org", org);

    fetch(`/book/options?${query.toString()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Booking options responded ${response.status}`);
        return response.json() as Promise<BookingOptions>;
      })
      .then((result) => setFetched({ link, result }))
      .catch(() => setFetched({ link, result: "failed" }));
  }, [link, ref, org]);

  const options = fetched?.link === link ? fetched.result : null;

  if (options === "failed") {
    // No retry button: a booking link is something people re-open, and a
    // refresh is an instruction everybody already knows how to follow.
    return (
      <Message
        heading="We couldn't load the booking form."
        detail="Please refresh the page, or contact us directly to schedule."
      />
    );
  }

  if (!options) return <BookingFormSkeleton />;

  if (options.status === "unavailable") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">
        Booking isn&apos;t available yet.
      </div>
    );
  }

  if (options.status === "unknown-link") {
    return (
      <Message
        heading="This booking link isn't valid."
        detail="Double check the link, or contact us directly."
      />
    );
  }

  if (options.status === "closed") {
    return (
      <Message
        heading="Booking isn't open right now."
        detail="Please contact us directly to schedule."
      />
    );
  }

  return (
    <BookingWizard
      organizationId={options.organizationId}
      organizationName={options.organizationName}
      referredByProfileId={options.referredByProfileId}
      services={options.services}
      slots={options.slots}
    />
  );
}
