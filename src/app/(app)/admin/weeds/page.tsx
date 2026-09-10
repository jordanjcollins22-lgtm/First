import { redirect } from "next/navigation";
import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { PrintPdfButton } from "@/components/print/print-pdf-button";
import { checkTabAccess } from "@/lib/data/access";
import { listWeeds } from "@/lib/data/weeds";
import { Card, CardContent } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { WeedGuide } from "@/components/weeds/weed-guide";

/**
 * Never prerendered. The guide puts itself in the first time it is opened, so
 * a copy of this page frozen at build time is a copy taken before the weeds
 * existed -- which is how it came to show two of sixty-three.
 */
export const dynamic = "force-dynamic";

/**
 * The weed guide.
 *
 * Sixty-three weeds come with the app, so nobody types a list of plants.
 * What the office does here is the part only a person can do: pick the one
 * photograph that goes on paper. A sheet cannot swap pictures, and a stock
 * photo of crabgrass is as often a picture of a lawn — so the printed sheet
 * uses the photo somebody chose, and every other photo waits on the screen a
 * scan of the printed code opens.
 */
export default async function WeedGuidePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("weeds");
  if (!allowed) redirect("/admin/tools");

  const weeds = await listWeeds();
  const onClientSheet = weeds.filter((w) => w.client).length;
  const withoutPhoto = weeds.filter((w) => !w.printPhotoId).length;
  const clientWithoutPhoto = weeds.filter((w) => w.client && !w.printPhotoId).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Weed Guide</h1>
          <p className="text-sm text-muted-foreground">
            One list of {weeds.length} weeds. The tick on each says whether it also goes on the sheet clients are
            given — {onClientSheet} of them do. The client sheet shows the picture and the name; the crew sheet shows
            the same weeds it is ticked for plus the scientific name and the prep note.
          </p>
        </div>
        {/* Two sheets, two ways each. The page is the quick look; the PDF is
            what goes to a printer, because printing the page leaves the
            margins to the browser and phones get them wrong. */}
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/weeds/sheet?view=client"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Client sheet
            </Link>
            <Link
              href="/admin/weeds/sheet?view=crew"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Crew reference
            </Link>
          </div>
          {/* Buttons rather than links to the file: with the app on a home
              screen there is no browser toolbar to print from. */}
          <div className="flex flex-wrap items-start gap-3">
            <PrintPdfButton
              href="/admin/weeds/sheet/pdf?view=client"
              label="Client sheet"
              fallbackName="weed-sheet.pdf"
            />
            <PrintPdfButton
              href="/admin/weeds/sheet/pdf?view=crew"
              label="Crew reference"
              fallbackName="weed-reference.pdf"
            />
          </div>
        </div>
      </header>

      {withoutPhoto > 0 && (
        <Card className="border-amber-300/70 bg-amber-50/60">
          <CardContent className="py-3 text-sm">
            <p className="font-medium text-amber-900">
              {withoutPhoto} {withoutPhoto === 1 ? "weed has" : "weeds have"} no photo to print
              {clientWithoutPhoto > 0 && ` — ${clientWithoutPhoto} of them on the client sheet`}.
            </p>
            <p className="text-amber-800">
              They come out as empty squares. Press <strong>Add the photo</strong> on a weed below to put one in; the
              list starts on exactly the ones still missing.
            </p>
          </CardContent>
        </Card>
      )}

      <WeedGuide weeds={weeds} />
    </div>
  );
}
