"use client";

import { useEffect, useRef } from "react";

import { reportCrewPosition } from "@/lib/actions/crew-position-actions";
import { metresBetween } from "@/lib/navigation";

/** How often the phone reports in when it has not moved much. */
const HEARTBEAT_MS = 20_000;
/** Moving this far reports straight away: a truck at 30 mph covers it in
 * three seconds, so the office sees the dot move along the road. */
const MOVE_METRES = 40;
/** Never more often than this, however the phone jitters. */
const MIN_GAP_MS = 4_000;

/**
 * Tells the office where this phone is, while the day is on.
 *
 * Only while the app is open: a browser tab cannot report from a pocket,
 * and this does not pretend to. Reports when the phone has moved a fair
 * way, or once a minute otherwise, so the office sees a dot that keeps up
 * with a truck without the phone sending its position every second.
 */
export function LocationBeacon({ active }: { active: boolean }) {
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;

    let stopped = false;
    function send(pos: GeolocationPosition, force = false) {
      if (stopped) return;
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const now = Date.now();
      const prev = last.current;
      const moved = prev ? metresBetween(prev, here) : Infinity;
      const stale = !prev || now - prev.at >= HEARTBEAT_MS;
      if (!force && !stale && moved < MOVE_METRES) return;
      if (!force && prev && now - prev.at < MIN_GAP_MS) return;
      last.current = { ...here, at: now };
      void reportCrewPosition({
        lat: here.lat,
        lng: here.lng,
        accuracy: pos.coords.accuracy ?? null,
        heading: pos.coords.heading ?? null,
      });
    }

    const watch = navigator.geolocation.watchPosition(
      (pos) => send(pos),
      () => {
        // Quiet. Nobody driving needs a red box because one fix was missed.
      },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 }
    );

    // Coming back to the app is worth a fresh report even if nothing moved.
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition((pos) => send(pos, true), () => {}, { maximumAge: 30_000, timeout: 10_000 });
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  return null;
}
