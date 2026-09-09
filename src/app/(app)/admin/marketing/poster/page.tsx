import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { assemblyOrder, planTiles } from "@/lib/poster-tiling";

/**
 * The neighbourhood sign, and the sizes of frame it fits.
 *
 * A frame sign that goes up while a crew is on the street. The neighbours see
 * the truck anyway; this is what turns seeing the truck into a phone call.
 *
 * Printed in pieces, because no printer here makes a twenty by thirty sheet.
 * The page says how many pieces before somebody presses print, since eight is
 * a different decision from one.
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Neighborhood Sign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;We&apos;re working in your neighborhood&rdquo; with a scannable offer, for a picture frame in a
          lawn or a window while a crew is on the street. It prints on the office printer in pieces, because
          no printer here makes a sheet that size. Cut each piece on its corner marks and tape the backs.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {SIZES.map((size) => {
          const plan = planTiles({ width: size.width, height: size.height });
          const href = `/admin/marketing/poster/pdf?w=${size.width}&h=${size.height}`;
          return (
            <div key={`${size.width}x${size.height}`} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {size.width} × {size.height} inches
              </p>
              <p className="text-xs text-muted-foreground">{size.note}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {plan.tiles.length} sheet{plan.tiles.length === 1 ? "" : "s"}, {plan.rows} down by{" "}
                {plan.columns} across, printed {plan.orientation}.
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
          );
        })}
      </div>

      <section className="rounded-lg border border-border p-3 text-sm">
        <h3 className="font-semibold">Putting one together</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Print it. Actual size, not &ldquo;fit to page&rdquo;, or the pieces will not meet.</li>
          <li>Cut every sheet on the four corner marks. There is a strip of extra artwork past them, so a cut
            that wanders still lands on ink.</li>
          <li>{assemblyOrder(planTiles({ width: 20, height: 30 })).split(". ").slice(1).join(". ")}</li>
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
