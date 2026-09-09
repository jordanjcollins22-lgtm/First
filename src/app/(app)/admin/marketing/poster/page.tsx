import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { SignPreview } from "@/components/marketing/sign-preview";
import { planPieces, signMeasure } from "@/lib/poster-render";

/**
 * The neighbourhood sign, and the sizes of frame it fits.
 *
 * A frame sign that goes up while a crew is on the street. The neighbours see
 * the truck anyway; this is what turns seeing the truck into a phone call.
 *
 * Printed as cutouts rather than as a poster in pieces. Nothing is taped to
 * anything: every phrase comes out at its finished size on its own sheet, gets
 * cut out on straight lines, and goes on the board where the map says.
 */
export const dynamic = "force-dynamic";

/** The frames somebody can actually buy without ordering one. */
const SIZES = [
  { width: 20, height: 30, note: "The one on the shelf" },
  { width: 24, height: 36, note: "Bigger, for a lawn" },
  { width: 18, height: 24, note: "For a window" },
  { width: 11, height: 17, note: "Counter or door" },
];

export default async function PosterPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("signs", "/admin/tools");

  const organization = await getCurrentOrganization();
  const measure = await signMeasure();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Neighborhood Sign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;We&apos;re working in your neighborhood&rdquo; with a scannable offer, for a picture frame in a
          lawn or a window while a crew is on the street. It prints on the office printer as cutouts: each
          phrase at its finished size on its own sheet. Cut them out and lay them on the board. Nothing joins
          to anything, so there are no seams to line up.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {SIZES.map((size) => {
          const plan = planPieces({ width: size.width, height: size.height }, organization.name, measure);
          const href = `/admin/marketing/poster/pdf?w=${size.width}&h=${size.height}`;
          return (
            <div key={`${size.width}x${size.height}`} className="flex gap-3 rounded-lg border border-border p-3">
              <SignPreview plan={plan} />
              <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {size.width} × {size.height} inches
              </p>
              <p className="text-xs text-muted-foreground">{size.note}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {plan.pieces.length} cutout{plan.pieces.length === 1 ? "" : "s"}, one per sheet, plus a map and
                a list.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  Open PDF
                </a>
                <a href={`${href}&download=1`} className="text-xs text-primary hover:underline">
                  Save it
                </a>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="rounded-lg border border-border p-3 text-sm">
        <h3 className="font-semibold">Putting one together</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Print it. Actual size, not &ldquo;fit to page&rdquo;, or the cutouts come out the wrong size for
            the frame.</li>
          <li>Cut each sheet on its dashed outline. Every cut is a straight line, so a paper trimmer does the
            lot in a couple of minutes.</li>
          <li>Lay them on the board using the first two sheets: the map shows the whole sign with every piece
            numbered, and the list gives each one&apos;s size and how far down and across it goes.</li>
          <li>Tape or glue the backs once you are happy with where they sit. A piece an eighth of an inch out
            reads as hand-made, not as broken, because the gaps between cutouts are word spaces.</li>
          <li>On white foam board the paper edges disappear and the words look printed straight onto it. On a
            dark board they read as white cards, which looks deliberate too. Either is fine.</li>
          <li>Drop it in the frame. The code goes to the booking form, tagged so a booking off this sign shows
            up as one.</li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          The sign is drawn rather than scaled from a picture, so it is sharp at any size. It uses your
          business name set in type where a logo would go.{" "}
          <Link href="/admin/tools" className="text-primary hover:underline">
            Send me a logo file
          </Link>{" "}
          and I will put the real one on it.
        </p>
      </section>
    </div>
  );
}
