"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Crosshair, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  feetBetween,
  formatCoordinates,
  NOTABLE_DRIFT_FEET,
  parseCoordinates,
  type Point,
} from "@/lib/coordinates";
import { setPropertyLocation } from "@/lib/actions/property-actions";

/**
 * Where the property actually is, said by somebody standing on it.
 *
 * Every address here is placed by geocoding what a client typed, which is
 * wrong often enough to matter: new builds are not in the database, a long
 * driveway puts the pin on the road, and a street named Court usually
 * geocodes to the mouth of the close rather than to the house, so the
 * satellite photo comes back showing the wrong roof.
 *
 * Nothing could correct that. The coordinates were written once when the
 * property was created and never again, so a bad placement was permanent and
 * every route, map and photo inherited it. The evaluator is the one person
 * who can fix it, and the moment they can is while they are there.
 *
 * Two ways in, because people have a location to hand in two different forms.
 * The phone knows where it is, which is one tap. And a pin dropped in Google
 * or Apple Maps is a pasted string, which is what somebody does when the
 * house is not where they are parked.
 *
 * Shown always rather than only when something looks wrong, because "wrong"
 * is exactly what cannot be detected from here: a geocode that landed on the
 * neighbour's roof looks perfectly plausible to everything except a person
 * looking at the house.
 */
export function LocationPanel({
  propertyId,
  address,
  lat,
  lng,
}: {
  propertyId: string;
  address: string;
  /** What the property is placed at now. Null on a property never geocoded. */
  lat: number | null;
  lng: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [candidate, setCandidate] = useState<Point | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);

  const current: Point | null = lat != null && lng != null ? { lat, lng } : null;
  const drift = current && candidate ? feetBetween(current, candidate) : null;

  function offer(point: Point, note: string | null) {
    setCandidate(point);
    setWarning(note);
    setError(null);
    setSaved(false);
  }

  /** What the phone says, which is the one tap version. */
  function useMyLocation() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device will not share its location. Paste a pin instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = {
          lat: Math.round(position.coords.latitude * 1e6) / 1e6,
          lng: Math.round(position.coords.longitude * 1e6) / 1e6,
        };
        // A reading good to a hundred metres is a phone guessing off cell
        // towers, and saving it would replace one wrong pin with another.
        const accuracy = position.coords.accuracy;
        offer(
          point,
          accuracy > 50
            ? `This reading is only accurate to about ${Math.round(accuracy)} metres. Worth checking before saving.`
            : null
        );
        setTyped(formatCoordinates(point));
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is switched off for this site. Turn it on, or paste a pin instead."
            : "Could not get a location just now. Paste a pin instead."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  }

  function read(text: string) {
    setTyped(text);
    setSaved(false);
    if (!text.trim()) {
      setCandidate(null);
      setWarning(null);
      setError(null);
      return;
    }
    const parsed = parseCoordinates(text);
    if (parsed.ok) offer(parsed.point, parsed.warning);
    else {
      setCandidate(null);
      setWarning(null);
      setError(parsed.message);
    }
  }

  function save() {
    if (!candidate) return;
    start(async () => {
      const result = await setPropertyLocation({
        propertyId,
        lat: candidate.lat,
        lng: candidate.lng,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      setError(null);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <MapPin className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">Where this property actually is</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {current ? formatCoordinates(current) : "Never placed"}
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {address} is placed by looking the address up, which is wrong often enough to matter on
            a new build, a long driveway, or anything on a court. Everything that draws a map,
            plans a route or pulls a satellite photo uses this, so fixing it here fixes all of
            them.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={locating || pending}
              onClick={useMyLocation}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-accent"
            >
              <Crosshair className="h-3.5 w-3.5" />
              {locating ? "Getting a fix…" : "Use where I am standing"}
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Or paste a pin from Google or Apple Maps, or a pair of coordinates
            </span>
            <input
              type="text"
              value={typed}
              onChange={(event) => read(event.target.value)}
              placeholder="39.512345, -76.345678"
              className="h-10 rounded-md border border-border bg-background px-2.5 text-sm"
            />
          </label>

          {candidate && (
            <div className="rounded-md border border-border p-2.5">
              <p className="text-xs font-medium">{formatCoordinates(candidate)}</p>
              {drift != null && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {drift === 0
                    ? "Exactly where it is already placed."
                    : `${drift.toLocaleString()} ft from where it is placed now.`}
                  {drift > NOTABLE_DRIFT_FEET &&
                    " That is far enough to be a different house, so worth being sure."}
                </p>
              )}
              {warning && (
                <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-500">
                  {warning}
                </p>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={save}
                className={cn(
                  "mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                  saved
                    ? "border border-primary bg-primary/10 text-primary"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {saved ? <Check className="h-3.5 w-3.5" /> : null}
                {saved ? "Saved" : pending ? "Saving…" : "Save this as the location"}
              </button>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}
