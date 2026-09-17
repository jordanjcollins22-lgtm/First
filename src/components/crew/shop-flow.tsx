"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Map as MapIcon, Navigation, Package, Truck, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FocusableSiteMap } from "@/components/proposal/focusable-site-map";
import { arriveAtShop, headOut, setShopPage, setShopStage, setShownJobs, tickShopItem } from "@/lib/actions/shop-flow-actions";
import { allLoaded, clampPage, loadPages, pageComplete, STAGE_LABEL } from "@/lib/shop-flow";
import { zonesBounds } from "@/lib/work-order";
import type { Loadout, LoadoutItem } from "@/lib/loadout";
import type { Stop } from "@/lib/crew-day";
import type { ShopDay, SiteMapCard } from "@/lib/data/shop-flow";

/**
 * The shop screen.
 *
 * On the tablet the lead runs it: clock in, one kit at a time, the maps
 * for the stops they pick, then out the door. On a phone it is the same
 * page, following along, with the list tickable and nothing else to press.
 */
export function ShopFlow({
  me,
  shopDay,
  loadout,
  stops,
  siteMaps,
  present,
}: {
  me: { profileId: string; name: string; canLead: boolean; arrived: boolean };
  shopDay: ShopDay | null;
  loadout: Loadout;
  stops: Stop[];
  siteMaps: SiteMapCard[];
  present: { profileId: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isLead = Boolean(shopDay && (shopDay.leadProfileId === me.profileId || me.canLead));

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.message ?? "Something went wrong.");
      router.refresh();
    });
  }

  const header = (
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {shopDay ? STAGE_LABEL[shopDay.stage] : "At the shop"}
      </p>
      {present.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {present.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );

  // ------------------------------------------------------------ clock in
  if (!shopDay || !me.arrived) {
    return (
      <section className="rounded-2xl border border-white/60 bg-card/80 p-4 shadow-sm backdrop-blur-md">
        {header}
        <p className="mt-1 text-lg font-bold leading-snug">
          {shopDay ? `${shopDay.leadName} has opened the day.` : me.canLead ? "Open the day." : "Waiting for the lead to open the day."}
        </p>
        <p className="text-sm text-muted-foreground">One tap says you are here and starts your time.</p>
        <Button
          type="button"
          disabled={isPending}
          onClick={() => run(() => arriveAtShop({ openDay: !shopDay && me.canLead }))}
          className="mt-3 h-16 w-full text-lg font-semibold"
        >
          {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Truck className="mr-2 h-5 w-5" />}
          I&apos;m at the shop
        </Button>
        {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------- loadout
  if (shopDay.stage === "loadout") {
    const pages = loadPages(loadout);
    const index = clampPage(shopDay.pageIndex, pages);
    const page = pages[index] ?? null;
    const done = allLoaded(pages);
    return (
      <section className="rounded-2xl border border-amber-500/50 bg-amber-50/60 p-4 shadow-sm">
        {header}
        {pages.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing listed to load today. Set what to bring on each visit from the job page.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {index + 1} of {pages.length} · {loadout.done}/{loadout.total} on the truck
            </p>
            {page && (
              <div className="mt-2">
                <p className="text-2xl font-bold leading-tight">{page.title}</p>
                {page.subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{page.subtitle}</p>}
                <ul className="mt-3 flex flex-col gap-2">
                  {page.items.map((item) => (
                    <TickRow
                      key={`${item.kind}:${item.key}`}
                      item={item}
                      who={shopDay.checkedBy[`${item.kind}:${item.key}`] ?? null}
                      disabled={isPending}
                      onTick={() => run(() => tickShopItem({ shopDayId: shopDay.id, kind: item.kind, key: item.key, checked: !item.checked }))}
                    />
                  ))}
                </ul>
              </div>
            )}
            {isLead && (
              <div className="mt-4 flex gap-2">
                <Button type="button" variant="outline" disabled={isPending || index === 0} onClick={() => run(() => setShopPage({ shopDayId: shopDay.id, pageIndex: index - 1 }))} className="h-12">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {index < pages.length - 1 ? (
                  <Button type="button" disabled={isPending || !page || !pageComplete(page)} onClick={() => run(() => setShopPage({ shopDayId: shopDay.id, pageIndex: index + 1 }))} className="h-12 flex-1 text-base font-semibold">
                    Next kit
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" disabled={isPending || !done} onClick={() => run(() => setShopStage({ shopDayId: shopDay.id, stage: "maps" }))} className="h-12 flex-1 text-base font-semibold">
                    <MapIcon className="mr-2 h-4 w-4" />
                    All loaded. Go over the maps
                  </Button>
                )}
              </div>
            )}
            {!isLead && <p className="mt-3 text-xs text-muted-foreground">{shopDay.leadName} turns the page when this one is on the truck.</p>}
          </>
        )}
        {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
      </section>
    );
  }

  // ---------------------------------------------------------------- maps
  if (shopDay.stage === "maps") {
    const shown = new Set(shopDay.shownJobIds);
    const first = stops[0] ?? null;
    return (
      <section className="rounded-2xl border border-white/60 bg-card/80 p-4 shadow-sm backdrop-blur-md">
        {header}
        <p className="mt-1 text-lg font-bold leading-snug">Today&apos;s stops</p>
        <ol className="mt-2 flex flex-col gap-1.5">
          {stops.map((stop, i) => (
            <li key={stop.jobId} className={`flex items-center gap-2 rounded-lg border p-2 ${shown.has(stop.jobId) ? "border-primary bg-primary/5" : "border-border"}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{stop.customerName}</span>
                <span className="block truncate text-xs text-muted-foreground">{stop.address}</span>
              </span>
              {isLead && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    const next = shown.has(stop.jobId) ? shopDay.shownJobIds.filter((id) => id !== stop.jobId) : [...shopDay.shownJobIds, stop.jobId];
                    run(() => setShownJobs({ shopDayId: shopDay.id, jobIds: next }));
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-border"
                  aria-label={shown.has(stop.jobId) ? "Hide this map" : "Show this map to everyone"}
                >
                  {shown.has(stop.jobId) ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
              )}
            </li>
          ))}
        </ol>

        {siteMaps.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{isLead ? "Tap the eye on a stop to put its map on everybody's screen." : `${shopDay.leadName} hasn't put a map up yet.`}</p>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            {siteMaps.map((card) => (
              <div key={card.jobId}>
                <p className="text-base font-semibold">{card.customerName}</p>
                <p className="text-xs text-muted-foreground">{card.address}</p>
                {card.zones.length > 0 && card.siteImagePath && card.imageTransform ? (
                  <FocusableSiteMap
                    imagePath={card.siteImagePath}
                    transform={card.imageTransform}
                    numbered
                    dimSurroundings
                    defaultFrame={zonesBounds(card.zones, card.imageTransform.canvasWidth, card.imageTransform.canvasHeight)}
                    className="mt-2 w-full rounded-xl border border-white/60 bg-muted"
                    zones={card.zones.map((zone, i) => ({ zoneName: zone.name, color: zone.color, points: zone.points, number: i + 1 }))}
                  />
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No site map drawn on this job yet.</p>
                )}
                {card.zones.length > 0 && (
                  <ol className="mt-2 flex flex-col gap-1">
                    {card.zones.map((zone, i) => (
                      <li key={zone.id} className="rounded-md bg-background/70 px-2 py-1 text-sm">
                        <span className="font-semibold">{i + 1}. {zone.service}</span>
                        {zone.location && <span className="text-muted-foreground"> · {zone.location}</span>}
                        {zone.sizeLabel && <span className="text-muted-foreground"> · {zone.sizeLabel}</span>}
                        {zone.notes && <span className="block text-xs text-muted-foreground">{zone.notes}</span>}
                      </li>
                    ))}
                  </ol>
                )}
                <Link href={`/jobs/${card.jobId}/work-order`} className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline">
                  Full crew sheet
                </Link>
              </div>
            ))}
          </div>
        )}

        {isLead && (
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => setShopStage({ shopDayId: shopDay.id, stage: "loadout" }))} className="h-12">
              <Package className="h-4 w-4" />
            </Button>
            <Button type="button" disabled={isPending || !first} onClick={() => first && run(() => headOut({ shopDayId: shopDay.id, firstJobId: first.jobId }))} className="h-12 flex-1 text-base font-semibold">
              <Navigation className="mr-2 h-4 w-4" />
              {first ? `Head to ${first.customerName}` : "No stops today"}
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------ en route
  const first = stops[0] ?? null;
  return (
    <section className="rounded-2xl border border-primary/40 bg-primary/5 p-4 shadow-sm">
      {header}
      <p className="mt-1 text-lg font-bold leading-snug">{first ? `On the way to ${first.customerName}` : "On the road"}</p>
      {first && <p className="text-sm text-muted-foreground">{first.address}</p>}
      {first && (
        <Link href={`/jobs/${first.jobId}/directions`} className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground">
          <Navigation className="h-5 w-5" />
          Directions
        </Link>
      )}
    </section>
  );
}

function TickRow({ item, who, disabled, onTick }: { item: LoadoutItem; who: string | null; disabled: boolean; onTick: () => void }) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onTick}
        aria-pressed={item.checked}
        className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${item.checked ? "border-emerald-600/40 bg-white/70" : "border-border bg-background/80"}`}
      >
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${item.checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background"}`}>
          {item.checked && <Check className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold leading-snug">{item.label}</span>
          {item.kind !== "kit" && <span className="block text-xs text-muted-foreground">For {item.forStops.join(", ")}</span>}
          {item.checked && who && <span className="block text-xs text-emerald-800">On the truck, {who}</span>}
        </span>
      </button>
    </li>
  );
}
