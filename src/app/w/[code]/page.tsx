import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { weedByCode, weedPhotoUrl } from "@/lib/data/weeds";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { WeedPhotos } from "@/components/weeds/weed-photos";

/**
 * One weed, from the code printed under it.
 *
 * The sheet in somebody's hand has one photograph of this plant. Here are
 * all of them, to be flicked through — a weed looks like four different
 * things depending on whether it has flowered, and one photo on paper can
 * only ever be one of them. That is what the code is for.
 */
export default async function ScannedWeedPage({ params }: { params: Promise<{ code: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { code } = await params;
  const weed = await weedByCode(code);
  if (!weed) notFound();

  const photos = await Promise.all(
    weed.photos.map(async (photo) => ({
      id: photo.id,
      url: await weedPhotoUrl(photo.path),
      caption: photo.caption,
      credit: photo.credit,
    }))
  );

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{weed.group}</p>
      <h1 className="mt-0.5 text-2xl font-semibold">{weed.common}</h1>
      <p className="text-sm italic text-muted-foreground">{weed.scientific}</p>

      <div className="mt-4">
        <WeedPhotos photos={photos} name={weed.common} />
      </div>

      {weed.prep && (
        <section className="mt-5 rounded-lg border border-border/60 bg-card p-3">
          <h2 className="text-sm font-medium">Before treating it</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{weed.prep}</p>
        </section>
      )}

      <p className="mt-6 font-mono text-xs tracking-wider text-muted-foreground">{weed.code}</p>
    </main>
  );
}
