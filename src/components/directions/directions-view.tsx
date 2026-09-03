"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { ArrowLeft, ExternalLink, Loader2, Navigation, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { getDrivingRoute } from "@/lib/actions/directions-actions";
import {
  arrivalTime,
  externalNavUrl,
  formatDistance,
  formatDuration,
  routeBounds,
  type Route,
} from "@/lib/directions";
import { arrivalClock, navigate, spokenDistance, spokenDuration } from "@/lib/navigation";

if (env.mapboxToken) {
  mapboxgl.accessToken = env.mapboxToken;
}

export interface DirectionsDestination {
  jobId: string;
  address: string;
  customerName: string;
  lat: number | null;
  lng: number | null;
}

/**
 * The way to the next stop, inside the app.
 *
 * The route line and the turn list, from wherever the phone says it is. Not
 * live voice navigation — no re-routing, no lane guidance — because a worse
 * copy of Google Maps helps nobody. The handover to a real navigation app sits
 * at the bottom for anybody who wants that, and says so plainly rather than
 * hiding behind an icon.
 *
 * Location is asked for once, on a tap, rather than on load. A permission
 * prompt that appears before somebody has said what they want is the prompt
 * everybody denies.
 */
export function DirectionsView({
  destination,
  back,
}: {
  destination: DirectionsDestination;
  back: { href: string; label: string };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const meRef = useRef<mapboxgl.Marker | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasPin = destination.lat != null && destination.lng != null;

  const load = useCallback(() => {
    if (!hasPin) return;
    setError(null);
    setLoading(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const from = { lat: position.coords.latitude, lng: position.coords.longitude };
        setOrigin(from);
        const result = await getDrivingRoute(from, {
          lat: destination.lat as number,
          lng: destination.lng as number,
        });
        if (result.ok) setRoute(result.route);
        else setError(result.message);
        setLoading(false);
      },
      () => {
        // Named plainly: on a phone this is nearly always the permission
        // prompt having been dismissed, and "location unavailable" sends
        // somebody hunting for a signal problem they do not have.
        setError("Couldn't get your location. Allow location for this site, then try again.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, [destination.lat, destination.lng, hasPin]);

  /**
   * Follow the driver.
   *
   * Started only once there is a route, and stopped the moment the component
   * goes away — a watch left running is a phone with the GPS on in somebody's
   * pocket for the rest of the day.
   *
   * Every fix recomputes the whole state rather than advancing a counter. A
   * navigator that accumulates is one missed reading away from confidently
   * describing a different journey; recomputed, it can be wrong for one
   * second and right on the next.
   */
  useEffect(() => {
    if (!route || !hasPin) return;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        // Silent. The route is already on screen and a driver does not need a
        // red box because one fix was missed at a junction.
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [route, hasPin]);

  const nav =
    route && origin && destination.lat != null && destination.lng != null
      ? navigate({
          position: origin,
          destination: { lat: destination.lat, lng: destination.lng },
          route: { ...route, steps: route.steps },
        })
      : null;

  /**
   * Start on arrival.
   *
   * Location used to be asked for on a tap, on the reasoning that a
   * permission prompt appearing before somebody has said what they want is
   * the prompt everybody denies. That reasoning was about a page somebody
   * lands on. This one is reached by pressing "Directions" next to an
   * address, which is somebody saying what they want as plainly as they can,
   * and then being asked to press a second button to get it.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !hasPin) return;
    started.current = true;
    load();
  }, [hasPin, load]);

  // Draw the map once there is a route to draw. Rebuilt rather than diffed:
  // a new route replaces the old one wholesale, and there is nothing to
  // preserve between two different journeys.
  useEffect(() => {
    if (!route || !containerRef.current || !env.mapboxToken) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: route.coordinates[0],
      zoom: 12,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.coordinates } },
      });
      // Two lines: a wide dark casing under a bright core, so the route stays
      // readable over both pale roads and dark satellite patches.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2f6d3c", "line-width": 5 },
      });

      new mapboxgl.Marker({ color: "#2f6d3c" })
        .setLngLat(route.coordinates[route.coordinates.length - 1])
        .addTo(map);


      const bounds = routeBounds(route.coordinates);
      if (bounds) map.fitBounds(bounds, { padding: 48, duration: 0 });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      meRef.current = null;
    };
    // Deliberately not depending on `origin`: this rebuilds the map, and
    // rebuilding it on every position fix would tear the map down twice a
    // second while somebody is driving. The dot moves in its own effect below.
  }, [route]);

  /** The driver's dot, moved rather than redrawn. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !origin) return;

    if (!meRef.current) {
      meRef.current = new mapboxgl.Marker({ color: "#1d4ed8" })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map);
    } else {
      meRef.current.setLngLat([origin.lng, origin.lat]);
    }
  }, [origin]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-4">
      <Link
        href={back.href}
        className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        {back.label}
      </Link>

      <header>
        <h1 className="text-xl font-bold leading-snug">{destination.address}</h1>
        <p className="text-sm text-muted-foreground">{destination.customerName}</p>
      </header>

      {/* The one thing somebody driving actually reads. Big, above the map,
          and the distance before the words -- at a glance from a cab, "500 ft"
          is the part that decides whether to start moving over. */}
      {nav && (
        <div
          className={`rounded-2xl border p-4 ${
            nav.arrived
              ? "border-emerald-400/60 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10"
              : nav.offRoute
                ? "border-amber-400/60 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10"
                : "border-border bg-card/60"
          }`}
        >
          {nav.arrived ? (
            <p className="text-xl font-bold">You have arrived.</p>
          ) : (
            <>
              {nav.metresToTurn != null && (
                <p className="text-3xl font-bold leading-none tabular-nums">
                  {spokenDistance(nav.metresToTurn)}
                </p>
              )}
              <p className="mt-1 text-lg font-semibold leading-snug">{nav.instruction}</p>
              {nav.offRoute && (
                <p className="mt-2 text-sm">
                  You have come off the route.{" "}
                  <button type="button" onClick={load} className="font-semibold underline">
                    Work it out again
                  </button>
                </p>
              )}
            </>
          )}

          {!nav.arrived && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {spokenDuration(nav.remainingSeconds)}
              </span>
              <span>{spokenDistance(nav.remainingMetres)}</span>
              <span>Arrive {arrivalClock(nav.remainingSeconds)}</span>
            </p>
          )}
        </div>
      )}

      {!hasPin && (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-3 text-sm">
          This property has no pin on the map, so the app can&apos;t draw a route to it. The link below
          will search for the address instead.
        </p>
      )}

      {hasPin && !route && (
        <Button type="button" size="xl" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Navigation className="h-5 w-5" />}
          {loading ? "Working out the way\u2026" : "Start the route"}
        </Button>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm">{error}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={load}>
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}

      {route && (
        <>
          <div className="flex items-baseline justify-between gap-2 rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
            <div>
              <p className="text-xl font-bold">{formatDuration(route.duration)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistance(route.distance)} · there by {arrivalTime(route.duration)}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>

          <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-xl border border-white/60" />

          <ol className="flex flex-col gap-1.5">
            {route.steps.map((step, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-white/60 bg-card/60 p-2.5 backdrop-blur-md"
              >
                <span className="flex min-w-0 items-baseline gap-2 text-sm">
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span>{step.instruction}</span>
                </span>
                {step.distance > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDistance(step.distance)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {/* Said plainly rather than hidden behind an icon: this screen draws the
          way, it does not talk you through it. */}
      <a
        href={externalNavUrl(destination)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-background/60 text-sm font-medium"
      >
        <ExternalLink className="h-4 w-4" />
        Open in Maps for spoken turn-by-turn
      </a>
    </div>
  );
}
