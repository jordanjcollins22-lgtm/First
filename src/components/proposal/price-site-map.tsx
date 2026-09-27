"use client";

import { SiteMapImage } from "@/components/proposal/site-map-image";
import type { PriceApproval } from "@/lib/data/price-approvals";

/**
 * The whole site map on the price card, numbered to match the areas under
 * it: the satellite photo with the areas drawn on, as the proposal shows
 * it, or the practice drawing for the sample job.
 */
export function PriceSiteMap({ map }: { map: NonNullable<PriceApproval["siteMap"]> }) {
  if (map.kind === "image") {
    return <SiteMapImage imagePath={map.imagePath} transform={map.transform} zones={map.zones} numbered showLegend={false} className="rounded-xl" />;
  }
  return (
    <svg viewBox="0 0 400 260" className="w-full rounded-xl border border-border bg-emerald-50 dark:bg-emerald-950/30" role="img" aria-label="The site map">
      <rect x="110" y="50" width="180" height="130" rx="4" className="fill-stone-300 dark:fill-stone-700" />
      <text x="200" y="120" textAnchor="middle" className="fill-stone-600 text-[12px] dark:fill-stone-300">
        House
      </text>
      {map.zones.map((z, i) => {
        const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
        const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
        return (
          <g key={`${z.name}-${i}`}>
            <polygon points={z.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={z.color} fillOpacity={0.35} stroke={z.color} strokeWidth={2} />
            <circle cx={cx} cy={cy} r={10} fill={z.color} />
            <text x={cx} y={cy + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
