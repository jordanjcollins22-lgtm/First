import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listWeeds, weedPhotoUrl } from "@/lib/data/weeds";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { columnsFor, groupWeeds, isSheetView, weedScanPath, weedsFor, type Weed } from "@/lib/weeds";
import { qrSvg } from "@/lib/qr";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PrintButton } from "@/components/weeds/print-button";

interface Cell {
  weed: Weed;
  photoUrl: string | null;
  qr: string;
}

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
        qr: await qrSvg(`${origin}${weedScanPath(weed.code)}`, 96),
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
          {missingPhotos > 0 && (
            <p className="mt-1 text-sm text-amber-700">
              {missingPhotos} {missingPhotos === 1 ? "weed has" : "weeds have"} no print photo yet and will come out as
              an empty square. Upload one on the guide before this goes to the printer.
            </p>
          )}
        </div>
        <PrintButton />
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
                      {view === "crew" && (
                        <p className="text-[8px] italic leading-tight text-black/60">{weed.scientific}</p>
                      )}
                      <div className="mt-1 flex items-center gap-1">
                        <span
                          className="block h-7 w-7 shrink-0 [&>svg]:h-full [&>svg]:w-full"
                          aria-hidden
                          dangerouslySetInnerHTML={{ __html: cell?.qr ?? "" }}
                        />
                        <span className="font-mono text-[8px] tracking-wider text-black/70">{weed.code}</span>
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
