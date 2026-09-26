import Link from "next/link";
import { CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { loadBookingOptions } from "@/lib/data/booking-options";
import { listProofRows, proofFromRows } from "@/lib/data/booking-proof";
import { BOOKING_PAGES, promisesKept } from "@/lib/booking-proof";
import { BookingPreview } from "@/components/booking/booking-preview";
import { ProofEditor } from "@/components/booking/proof-editor";
import { ReviewSourcesPanel } from "@/components/booking/review-sources-panel";
import { listReviewSources } from "@/lib/data/review-sources";
import { EXTENSION_VERSION, versionIsBehind } from "@/lib/outreach-agent-recipe";

/**
 * Booking Page: the owner's view of what a client sees after tapping the
 * link in a comment.
 *
 * The same card, in preview: every page can be clicked to from the arrows,
 * nothing is recorded, and nothing books. Next to it, what the comments
 * promise and whether the page backs each one up, and where the reviews and
 * the news story are entered.
 */
export const dynamic = "force-dynamic";

export default async function BookingPagePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("booking-page", "/marketing");
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", profile.organization_id).maybeSingle();
  const slug = org?.slug ?? null;

  const [rows, options, sources, { data: agent }] = await Promise.all([
    listProofRows(profile.organization_id),
    slug ? loadBookingOptions({ org: slug }).catch(() => null) : Promise.resolve(null),
    listReviewSources(profile.organization_id).catch(() => []),
    supabase.from("outreach_agent_settings").select("extension_version").eq("organization_id", profile.organization_id).maybeSingle(),
  ]);
  const installed = agent?.extension_version ?? null;
  // What the card shows, read fresh from the editor's rows, so a review just
  // added is in the preview straight away.
  const proof = proofFromRows(rows);
  const promises = promisesKept(proof);
  const serviceNames = options?.status === "ok" ? options.services.map((s) => s.name) : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Booking Page</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What somebody sees after tapping the link in a comment: one card, {BOOKING_PAGES.length} pages. The first says
          what the comment said and shows it. Click through every page with the arrows; nothing here books.
        </p>
        {slug && (
          <Link href={`/book?org=${encodeURIComponent(slug)}`} target="_blank" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Open the real page <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div>
          {options?.status === "ok" ? (
            <BookingPreview
              serviceNames={serviceNames}
              organizationId={options.organizationId}
              organizationName={options.organizationName}
              referredByProfileId={null}
              services={options.services}
              slots={options.slots}
              noticeText={options.noticeText}
              linkRef={null}
              linkOrg={slug}
              referralCode={null}
              proof={proof}
            />
          ) : (
            <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
              {options?.status === "closed"
                ? "Nobody can be booked for an evaluation right now, so clients see “Booking isn’t open right now.” Set somebody’s evaluation hours first."
                : "The booking page couldn’t be loaded for a preview just now."}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">What the comments promise</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Every comment says these. The landing card only shows a claim once there is something to back it up.
            </p>
            <ul className="flex flex-col gap-2">
              {promises.map((p) => (
                <li key={p.promise} className="flex items-start gap-2 text-sm">
                  {p.kept ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <span>
                    <span className="font-medium">{p.promise}</span>
                    <span className={`block text-xs ${p.kept ? "text-muted-foreground" : "text-amber-700"}`}>{p.how}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <ReviewSourcesPanel
            sources={sources}
            extensionBehind={Boolean(installed && versionIsBehind(installed, EXTENSION_VERSION))}
            expectedVersion={EXTENSION_VERSION}
          />

          <ProofEditor rows={rows} />
        </div>
      </div>
    </div>
  );
}
