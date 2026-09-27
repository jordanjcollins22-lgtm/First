import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { listBusinessLocations } from "@/lib/data/locations";
import { fetchLotFromCounty } from "@/lib/data/lot-map";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { AllPages } from "./all-pages";

/**
 * Every page of the pre-evaluation form at once, in order, the way a
 * client sees each one. Each is live to click, and nothing is saved.
 *
 * The lot on "Which parts of the property?" is the shop's own lot from the
 * county until another address is put in the demo box, which is marked as
 * not part of the form.
 */
export const dynamic = "force-dynamic";

export default async function PreEvaluationPreviewPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");

  const places = await listBusinessLocations().catch(() => []);
  const shop = places.find((p) => /shop/i.test(p.name) && p.lat != null && p.lng != null);
  const lot = shop ? await fetchLotFromCounty(shop.lat, shop.lng, shop.address ?? "").catch(() => null) : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <Link href="/my-day?tab=system" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> The system
      </Link>
      <header>
        <h1 className="text-xl font-bold">Pre-evaluation form, every page</h1>
        <p className="text-sm text-muted-foreground">
          What a client sees after they book, one page at a time, laid out side by side. The pages everyone gets are always here;
          pick a service at the top to add the pages it brings in. Nothing here is saved.{" "}
          <Link href="/prep/demo" className="text-primary hover:underline">
            Click through it as a client
          </Link>
          .
        </p>
      </header>
      <AllPages lot={lot} />
    </div>
  );
}
