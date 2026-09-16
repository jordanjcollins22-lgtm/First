import Link from "next/link";
import { Check, MapPin, Package, Truck, Users } from "lucide-react";

import { CrewMap } from "@/components/crew/crew-map";
import { spokenDistance } from "@/lib/navigation";
import { timeAgo } from "@/lib/proposal-views";

import type { CrewsToday } from "@/lib/data/crews-today";

/**
 * Today's work from the office chair.
 *
 * Which jobs, who is on each, and the list each person has to load before
 * they leave, with their ticks showing. It is the same list they see on
 * their phone, so what is wrong here is wrong there, and can be fixed on
 * the job page before the truck moves.
 */
export function CrewsTodayPanel({ today, showTicks }: { today: CrewsToday; showTicks: boolean }) {
  if (today.stops.length === 0) return null;
  const now = new Date();

  const dots = today.crews
    .filter((c) => c.position)
    .map((c) => {
      const to = c.heading ? today.stops.find((s) => s.jobId === c.heading!.jobId) : null;
      return {
        profileId: c.profileId,
        name: c.name,
        lat: c.position!.lat,
        lng: c.position!.lng,
        toLat: c.phase === "travelling" || c.phase === "between_stops" ? (to?.lat ?? null) : null,
        toLng: c.phase === "travelling" || c.phase === "between_stops" ? (to?.lng ?? null) : null,
      };
    });
  const pins = today.stops
    .map((s, i) => ({ index: i + 1, customerName: s.customerName, lat: s.lat, lng: s.lng }))
    .filter((p): p is { index: number; customerName: string; lat: number; lng: number } => p.lat != null && p.lng != null);

  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Truck className="h-4 w-4" />
        Jobs today ({today.stops.length})
      </h2>

      <ol className="mt-2 flex flex-col gap-1.5">
        {today.stops.map((stop, i) => (
          <li key={stop.sessionId} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 w-4 shrink-0 text-xs font-semibold text-muted-foreground">{i + 1}.</span>
            <span className="min-w-0 flex-1">
              <Link href={`/jobs/${stop.jobId}`} className="font-medium hover:underline">
                {stop.customerName}
              </Link>
              <span className="text-muted-foreground"> · {stop.address}</span>
              {stop.purpose && <span className="block text-xs text-muted-foreground">{stop.purpose}</span>}
              <span className="block text-xs">
                <Users className="mr-1 inline h-3 w-3 text-muted-foreground" />
                {stop.crewNames.length > 0 ? stop.crewNames.join(", ") : <span className="font-medium text-amber-800">Nobody on it yet</span>}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {pins.length > 0 && (
        <div className="mt-3">
          <CrewMap crews={dots} stops={pins} />
        </div>
      )}

      {today.crews.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {today.crews.map((person) => {
            const { loadout } = person;
            return (
              <div key={person.profileId} className="rounded-lg border border-border bg-background/70 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{person.name}</p>
                  {loadout.total > 0 && showTicks && (
                    <span
                      className={`text-xs font-semibold ${loadout.complete ? "text-emerald-700" : "text-amber-800"}`}
                    >
                      {loadout.done}/{loadout.total} loaded
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{person.headline}</p>
                <p className="mt-0.5 flex items-start gap-1 text-xs">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  {person.position ? (
                    <span>
                      Seen {timeAgo(person.position.at, now)}
                      {person.heading?.metres != null && (
                        <>
                          , {spokenDistance(person.heading.metres)} from {person.heading.customerName}
                        </>
                      )}
                      {" · "}
                      <a
                        href={`https://www.google.com/maps?q=${person.position.lat},${person.position.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        map
                      </a>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No location yet. It reports while their app is open.</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {person.stops.map((s) => s.customerName).join(" → ")}
                </p>

                <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Package className="h-3 w-3" />
                  Load at the shop
                </p>
                {loadout.total === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing listed. Set what to bring on each visit from the job page.
                  </p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {loadout.items.map((item) => (
                      <li key={`${item.kind}:${item.key}`} className="flex items-start gap-1.5 text-xs">
                        {showTicks ? (
                          <span
                            className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                              item.checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"
                            }`}
                          >
                            {item.checked && <Check className="h-2.5 w-2.5" />}
                          </span>
                        ) : (
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                        )}
                        <span className="min-w-0">
                          <span className="font-medium">{item.label}</span>
                          <span className="text-muted-foreground"> for {item.forStops.join(", ")}</span>
                          {item.detail && <span className="block text-[11px] text-muted-foreground">{item.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
