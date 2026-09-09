import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listWeeds, weedPhotoUrl } from "@/lib/data/weeds";
import { getCurrentOrganization } from "@/lib/data/organizations";
import {
  bookingPath,
  columnsFor,
  groupWeeds,
  isSheetView,
  printedPrep,
  rowsOf,
  showsBookingOffer,
  weedScanPath,
  weedsFor,
  type Weed,
} from "@/lib/weeds";
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

  const { view: rawView } = await searchParams;
  const view = isSheetView(rawView) ? rawView : "client";

  // The crew's reference is the guide in another shape, so it is gated like
  // the guide. The client's sheet is not: it is plant photographs, plant names
  // and a code that books us, and it says nothing about this business, this
  // client or anybody's job. Behind the Weed Guide tab it was reachable only
  // by an admin, which left the crew standing at somebody's door with no way
  // to produce the thing they were meant to hand over.
  const { allowed: canEditGuide, profile } = await checkTabAccess("weeds");
  if (!profile) redirect("/login");
  if (view === "crew" && !canEditGuide) redirect("/admin/tools");

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
  // The client's sheet ends with an offer, and the offer needs somewhere to
  // go. The org slug carries the booking through to the right business; the
  // page works without it, so a business that has not been given a slug still
  // gets a working code rather than none.
  const bookingUrl = `${origin}${bookingPath(organization.slug)}`;
  const bookingQr = showsBookingOffer(view)
    ? await qrSvg(bookingUrl, 256, "M").catch(() => null)
    : null;

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
            {shown.length} weeds{view === "crew" ? ", with scientific names" : ""}.{" "}
            {view === "client"
              ? "This is the one to leave with the client: the weeds they will point at, and an offer at the bottom to take the job on. "
              : ""}
            Every row carries its own code —
            scanning it opens that weed with all its photos.
          </p>
          {/* Printing this page hands the layout to whichever browser is
              holding it, and on a phone that has twice meant the top of the
              back pages missing. The PDF is drawn by us, page by page, so it
              is the one to send to a printer or to email somebody. */}
          <p className="mt-1 text-sm">
            <a
              href={`/admin/weeds/sheet/pdf?view=${view}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Open the PDF
            </a>{" "}
            <span className="text-muted-foreground">
              to print this properly, especially from a phone. It opens in the viewer, where print and share are. Or{" "}
            </span>
            <a
              href={`/admin/weeds/sheet/pdf?view=${view}&download=1`}
              className="text-primary hover:underline"
            >
              save it
            </a>
            <span className="text-muted-foreground"> to email it to somebody.</span>
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
          {/* Only for whoever can do something about it. A crew member about to
              hand this over cannot add a photo, and telling them one is missing
              is telling them their sheet is wrong with no way to fix it. */}
          {canEditGuide && missingPhotos > 0 && (
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
          {canEditGuide && (
            <Link href="/admin/weeds" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent">
              Back to the guide
            </Link>
          )}
          {/* Opened, not downloaded. A downloaded file on a phone goes into
              Files with no viewer and no print button, which is the whole
              reason somebody came here. */}
          <a
            href={`/admin/weeds/sheet/pdf?view=${view}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Open PDF
          </a>
          <PrintButton />
        </div>
      </div>

      {/* The page box, declared here rather than in globals.css because a
          page box cannot be selected by class and the app's other printed
          things -- the flyer, the door hanger -- are full bleed and want no
          margin at all. This route is the one that runs to several pages, so
          it is the one that needs a margin the paper gets on every one of
          them. Half an inch clears the unprintable strip on every consumer
          printer we have seen; without it the second and third pages started
          at the physical edge and came out with their top row cut off. */}
      <style>{`@media print {
        @page { size: letter portrait; margin: 0.35in 0.4in; }
        .print-root { left: 0; right: 0; width: auto !important; }
      }`}</style>

      <div className="print-root">
        <div className="weed-sheet mx-auto w-full bg-white text-black">
          <header className="weed-head mb-3 flex items-baseline justify-between border-b border-black/20 pb-2">
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
              {/* A row at a time, each its own box. One grid holding the whole
                  group is one box to the printer, and "keep this cell
                  together" inside it is advice a browser may ignore -- which
                  is how a page came to begin with the bottom half of a
                  photograph. A row that is its own box is kept together, and
                  it is also what carries the space that keeps the first row on
                  a page clear of the paper's edge. */}
              {rowsOf(block.weeds, columns).map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="weed-row grid gap-2"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {row.map((weed) => {
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
                          {/* One line: a cell has room for one, and the rest
                              of the note is for whoever scans the code. */}
                          {printedPrep(weed.prep) && (
                            <p className="mt-0.5 text-[8px] leading-tight text-black/70">{printedPrep(weed.prep)}</p>
                          )}
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
              ))}
            </section>
          ))}

          {/* The client's sheet closes with the two things a homeowner holding
              it needs from us: the warning that makes the difference between
              pulling a weed and propagating it, and an easy way to hand the job
              over. Kept off the crew's sheet -- they know, and they are not
              booking themselves. */}
          {showsBookingOffer(view) && (
            <section className="weed-cta mt-4 flex items-start gap-3 rounded border-2 border-black/60 p-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-bold leading-tight">Careful pulling these</h3>
                <p className="mt-1 text-[10px] leading-snug text-black/80">
                  Some of these spread if they are not taken out properly. Leave a piece of root behind and one
                  plant can come back as several — and a few of them are easier to make worse than to fix.
                </p>
                <p className="mt-1.5 text-[11px] font-semibold leading-snug">
                  Would you like a hand? Scan to book us.
                </p>
              </div>
              {bookingQr && (
                <span
                  className="weed-book-qr block shrink-0 bg-white [&>svg]:h-full [&>svg]:w-full"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: bookingQr }}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
