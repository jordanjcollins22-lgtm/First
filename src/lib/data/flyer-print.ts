import { createClient } from "@/lib/supabase/server";
import { outboundBaseUrl } from "@/lib/base-url";
import { listFlyerAds } from "@/lib/data/flyer";
import { listFlyerRuns } from "@/lib/data/flyer-runs";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { composeSheet } from "@/lib/flyer-sheet";
import type { FlyerArt } from "@/lib/flyer-render";
import { absolute } from "@/lib/proposal-flow";

export interface FlyerToPrint {
  art: FlyerArt;
  /** The run whose paid adverts are on it. Null when it is the standing flyer alone. */
  runName: string | null;
}

/**
 * The flyer that goes in the post now: the standing flyer, with the open
 * run's paid adverts on top, exactly as the Flyer page shows it. With no run
 * open it is the standing flyer alone, which is what a run nobody sold into
 * would print anyway.
 */
export async function getFlyerToPrint(): Promise<FlyerToPrint> {
  const [runs, organization, baseUrl] = await Promise.all([
    listFlyerRuns().catch(() => []),
    getCurrentOrganization().catch(() => null),
    outboundBaseUrl(),
  ]);
  const bookingUrl = organization?.slug ? absolute(baseUrl, `/flyer/${organization.slug}`) : null;
  const open = runs.find((r) => r.status === "open");
  if (open) return { art: { squares: open.squares, bookingUrl }, runName: open.name };

  const supabase = await createClient();
  const template = await listFlyerAds().catch(() => []);
  const squares = composeSheet({
    template,
    bookings: [],
    imageUrlFor: (path) => supabase.storage.from("flyer-ads").getPublicUrl(path).data.publicUrl,
  });
  return { art: { squares, bookingUrl }, runName: null };
}

/** The paper and printer as the inventory names them, for the page to say what to fetch. */
export async function getPrintSupplies(): Promise<{ paper: string | null; printer: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("materials")
    .select("name")
    .or("name.ilike.%gloss%paper%,name.ilike.%printer%")
    .limit(10);
  const names = ((data ?? []) as { name: string }[]).map((r) => r.name);
  return {
    paper: names.find((n) => /paper/i.test(n)) ?? null,
    printer: names.find((n) => /printer/i.test(n)) ?? null,
  };
}
