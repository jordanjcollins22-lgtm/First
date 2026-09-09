import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listWeeds, weedPhotoUrl } from "@/lib/data/weeds";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { columnsFor, groupWeeds, isSheetView, weedScanPath, weedsFor, type Weed } from "@/lib/weeds";
import { qrSvg } from "@/lib/qr";
import Link from "next/link";

import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PrintButton } from "@/components/weeds/print-button";

interface Cell {
  weed: Weed;
  photoUrl: string | null;
  qr: string;
}

/**
 * Never prerendered. The guide puts itself in the first time it is opened, so
 * a copy of this page frozen at build time is a copy taken before the weeds
 * existed -- which is how it came to show two of sixty-three.
 */
export const dynamic = "force-dynamic";

/**
 * The printed guide.
 *
 * One photograph, the name, and the weed's own QR. The photograph is the one
 * somebody chose for paper: a sheet cannot swap pictures the way a screen
 * can, so the choice is made once, by hand, and this is where it goes. The QR
 * is what makes the paper worth printing at all — scan it and the same weed
 * opens on a phone with every other photo of it.
 *
 * The client's sheet has the twenty-seven weeds a homeowner points at; the
 * crew's has all of them with their scientific names.
 */
export default async function WeedSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("weeds");
  if (!allowed) redirect("/admin/tools");

  const { view: rawView } = await searchParams;
  const view = isSheetView(rawView) ? rawView : "client";

  const [weeds, organization, headerList] = await Promise.all([listWeeds(), getCurrentOrganization(), headers()]);

  // A QR holds a whole address: a phone camera opens a link, it does not
  // know what a bare code means.
  const host = headerList.get("host") ?? "localhost:3000";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const shown = weedsFor(weeds, view);
  const cells: Cell[] = await Promise.all(
    shown.map(async (weed) => {
      const print = weed.photos.find((p) => p.id === weed.printPhotoId) ?? null;
      return {
        weed,
        photoUrl: print ? await weedPhotoUrl(print.path) : null,
        // "M" rather than "H", and generated large: this square is printed
        // about three-quarters of an inch across, so what decides whether a
        // phone reads it is how big one module is. See lib/qr.ts.
        qr: await qrSvg(`${origin}${weedScanPath(weed.code)}`, 256, "M"),
      };
    })
  );
  const byWeedId = new Map(cells.map((cell) => [cell.weed.id, cell]));
  const blocks = groupWeeds(shown);
  const columns = columnsFor(view);
  const missingPhotos = cells.filter((cell) => !cell.photoUrl).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="print-hide mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{view === "client" ? "Client weed sheet" : "Crew weed reference"}</h1>
          <p className="text-sm text-muted-foreground">
            {shown.length} weeds{view === "crew" ? ", with scientific names" : ""}. Every row carries its own code —
            scanning it opens that weed with all its photos.
          </p>
          {/* The back of every sheet came out upside down, which is a printer
              setting and not something a web page can see or change. Saying so
              here, next to the button, is the only place it helps: by the time
              the paper is in somebody's hand it is too late. Both names for the
              setting are given because printers disagree about what to call it. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Printing double-sided? Set the printer to flip on the{" "}
            <strong className="font-medium text-foreground">long edge</strong> (some drivers call it
            &ldquo;book&rdquo; binding). Flipping on the short edge — &ldquo;calendar&rdquo; or
            &ldquo;tablet&rdquo; — turns the back of every sheet upside down.
          </p>
          {missingPhotos > 0 && (
            <p className="mt-1 text-sm text-amber-700">
              {missingPhotos} {missingPhotos === 1 ? "weed has" : "weeds have"} no print photo yet and will come out as
              an empty square.{" "}
              <Link href="/admin/weeds" className="font-medium underline">
                Add photos in the Weed Guide
              </Link>{" "}
              before this goes to the printer.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/weeds" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent">
            Back to the guide
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="print-root">
        <div className="weed-sheet mx-auto w-full bg-white text-black">
          <header className="mb-3 flex items-baseline justify-between border-b border-black/20 pb-2">
            <h2 className="text-base font-semibold">
              {organization.name} · {view === "client" ? "Common lawn weeds" : "Weed reference"}
            </h2>
            <span className="text-[10px] text-black/60">Scan any weed for more photos</span>
          </header>

          {blocks.map((block) => (
            <section key={block.group} className="weed-group mb-3">
              <h3 className="weed-group-head mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/70">
                {block.group}
              </h3>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {block.weeds.map((weed) => {
                  const cell = byWeedId.get(weed.id);
                  return (
                    <article key={weed.id} className="weed-cell rounded border border-black/20 p-1.5">
                      <div className="mb-1 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-sm bg-black/5">
                        {cell?.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cell.photoUrl} alt={weed.common} className="h-full w-full object-cover" />
                        ) : (
                          <span className="px-1 text-center text-[8px] text-black/40">No photo chosen</span>
                        )}
                      </div>
                      <p className="text-[10px] font-semibold leading-tight">{weed.common}</p>
                      {/* The client sheet is a picture and a name: a homeowner
                          points at a weed, they do not treat it. The crew's
                          carries what a crew has to know. */}
                      {view === "crew" && (
                        <>
                          <p className="text-[8px] italic leading-tight text-black/60">{weed.scientific}</p>
                          {weed.prep && <p className="mt-0.5 text-[8px] leading-tight text-black/70">{weed.prep}</p>}
                        </>
                      )}
                      {/* The code is the reason the sheet is worth printing,
                          so it gets the room to work. It used to be twenty-eight
                          pixels square for a thirty-seven module grid -- under a
                          pixel a module, which prints as a grey smudge and
                          scans as nothing at all. */}
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className="weed-qr block shrink-0 bg-white [&>svg]:h-full [&>svg]:w-full"
                          aria-hidden
                          dangerouslySetInnerHTML={{ __html: cell?.qr ?? "" }}
                        />
                        <span className="min-w-0 truncate font-mono text-[9px] font-medium leading-tight tracking-wider text-black">
                          {weed.code}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
