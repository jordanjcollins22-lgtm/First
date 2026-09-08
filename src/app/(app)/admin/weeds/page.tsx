import { redirect } from "next/navigation";
import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listWeeds } from "@/lib/data/weeds";
import { groupWeeds } from "@/lib/weeds";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { WeedRow } from "@/components/weeds/weed-row";

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
  const blocks = groupWeeds(weeds);
  const onClientSheet = weeds.filter((w) => w.client).length;
  const withoutPhoto = weeds.filter((w) => !w.printPhotoId).length;
  const clientWithoutPhoto = weeds.filter((w) => w.client && !w.printPhotoId).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Weed Guide</h1>
          <p className="text-sm text-muted-foreground">
            {weeds.length} weeds, {onClientSheet} of them on the sheet clients are given. Every printed row carries its
            own code; scanning it opens that weed with all its photos.
          </p>
        </div>
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
      </header>

      {withoutPhoto > 0 && (
        <Card className="border-amber-300/70 bg-amber-50/60">
          <CardContent className="py-3 text-sm">
            <p className="font-medium text-amber-900">
              {withoutPhoto} {withoutPhoto === 1 ? "weed has" : "weeds have"} no photo to print
              {clientWithoutPhoto > 0 && ` — ${clientWithoutPhoto} of them on the client sheet`}.
            </p>
            <p className="text-amber-800">
              They come out as empty squares. The client sheet is the one that goes out to a house, so those are worth
              doing first.
            </p>
          </CardContent>
        </Card>
      )}

      {blocks.map((block) => (
        <Card key={block.group}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {block.group}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {block.weeds.length} · {block.weeds.filter((w) => w.client).length} on the client sheet
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {block.weeds.map((weed) => (
              <WeedRow key={weed.id} weed={weed} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
