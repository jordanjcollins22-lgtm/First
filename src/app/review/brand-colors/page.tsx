import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { BRAND_OPTIONS } from "@/lib/brand-colors";

/** The brand colour options side by side on a button, a header, a yard sign and a shirt, for reviewing from the Flow Board. */
export const dynamic = "force-dynamic";

export default function ReviewBrandColorsPage() {
  if (!reviewPagesEnabled()) notFound();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold">Brand colour options</h1>
      <p className="mb-4 text-sm text-muted-foreground">The app is switched to the recommended one on this preview. Each option is shown the way people would see it.</p>
      <div id="options" className="grid gap-4 sm:grid-cols-2">
        {BRAND_OPTIONS.map((o) => (
          <div key={o.key} className={`rounded-xl border bg-card p-4 ${o.recommended ? "border-2" : "border-border"}`} style={o.recommended ? { borderColor: o.primary } : undefined}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">{o.name}</h2>
              {o.recommended && (
                <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: o.primary }}>
                  Recommended
                </span>
              )}
              {o.current && <span className="rounded-full border border-border px-2 py-0.5 text-xs">Today</span>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{o.why}</p>
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 py-2 text-white" style={{ background: o.primary }}>
                <span className="font-bold">JS Landscaping</span>
                <span className="rounded px-2 py-0.5 text-xs font-bold" style={{ background: o.accent, color: o.key === "charcoal-orange" ? "#fff" : "#14181a" }}>
                  Book now
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 bg-white p-3">
                <span className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: o.primary }}>
                  Get a free estimate
                </span>
                <span className="text-sm font-semibold underline" style={{ color: o.primary }}>
                  See our work
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg p-3 text-center text-white" style={{ background: o.primary }}>
                <p className="text-[10px] uppercase tracking-wide opacity-80">Yard sign</p>
                <p className="text-lg font-black leading-tight">JS LANDSCAPING</p>
                <p className="mt-1 inline-block rounded px-2 text-xs font-bold" style={{ background: o.accent, color: o.key === "charcoal-orange" ? "#fff" : "#14181a" }}>
                  443-819-1521
                </p>
              </div>
              <div className="flex items-center justify-center rounded-lg bg-[#2b2f33] p-3">
                <div className="flex h-16 w-14 flex-col items-center justify-center rounded-t-lg text-[9px] font-black text-white" style={{ background: o.primary }}>
                  JS
                  <span className="mt-1 h-1 w-8 rounded" style={{ background: o.accent }} />
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2 text-xs">
              {[o.primary, o.primaryDark, o.accent].map((c) => (
                <span key={c} className="flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded border border-border" style={{ background: c }} />
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
