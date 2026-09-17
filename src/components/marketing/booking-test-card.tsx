import { FlaskConical } from "lucide-react";

import type { TestSummary } from "@/lib/booking-test";

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

/**
 * Tap or type: which books more.
 *
 * Two rows, one per side, and a verdict that refuses to be read too early.
 */
export function BookingTestCard({ test }: { test: TestSummary & { since: string | null } }) {
  const rows = [test.tap, test.type];
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        Booking page test: tap the address or type it
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Half of visitors get a &quot;Use my location&quot; button, half type. Same browser, same side every time. Only people count; crawlers are left out.
        {test.since && ` Running since ${new Date(test.since).toLocaleDateString()}.`}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="p-2 font-medium">Side</th>
              <th className="p-2 text-right font-medium">Visits</th>
              <th className="p-2 text-right font-medium">Booked</th>
              <th className="p-2 text-right font-medium">Rate</th>
              <th className="p-2 text-right font-medium">Tapped</th>
              <th className="p-2 text-right font-medium">Accepted</th>
              <th className="p-2 text-right font-medium">Declined</th>
              <th className="p-2 text-right font-medium">Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variant} className="border-b border-border last:border-0">
                <td className="p-2 font-medium">{r.variant === "tap" ? "Tap my location" : "Type it"}</td>
                <td className="p-2 text-right tabular-nums">{r.visits}</td>
                <td className="p-2 text-right tabular-nums">{r.bookings}</td>
                <td className="p-2 text-right font-semibold tabular-nums">{pct(r.rate)}</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{r.variant === "tap" ? r.tapped : "—"}</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{r.variant === "tap" ? r.accepted : "—"}</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{r.variant === "tap" ? r.declined : "—"}</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{r.variant === "tap" ? r.failed : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm">
        {test.verdict}
        {test.confidence != null && test.lift != null && Math.min(test.tap.visits, test.type.visits) >= 30 && (
          <span className="ml-1 text-muted-foreground">
            ({test.lift > 0 ? "+" : ""}{Math.round(test.lift * 100)} points, {Math.round(test.confidence * 100)}% sure)
          </span>
        )}
      </p>
    </section>
  );
}
