"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, MapPin, Navigation, UserRound } from "lucide-react";

import { reverseGeocode, searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { bookingLinkFor } from "@/lib/start-link";

/**
 * The address box on the landing page. Pick an address, or use where the
 * phone is, and the booking opens with it already in, on the page that asks
 * who they are. Anything the link carried (an affiliate's ?ref=) goes along.
 */
export function StartAddress() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(found: GeocodeSuggestion, located: boolean) {
    router.push(bookingLinkFor(found, { located, carry: params }));
  }

  function type(value: string) {
    setQuery(value);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) return setSuggestions([]);
    timer.current = setTimeout(async () => {
      setBusy("search");
      try {
        setSuggestions(await searchAddress(value));
      } catch {
        setSuggestions([]);
      } finally {
        setBusy(null);
      }
    }, 250);
  }

  // The arrow: the first match for what was typed.
  async function submit() {
    if (suggestions[0]) return go(suggestions[0], false);
    if (!query.trim()) return setError("Enter your address.");
    setBusy("search");
    try {
      const found = await searchAddress(query);
      if (found[0]) return go(found[0], false);
      setError("We couldn't find that address. Check it and try again.");
    } catch {
      setError("Address lookup is unavailable right now. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  function locate() {
    setError(null);
    if (!navigator.geolocation) return setError("Your browser can't share your location. Type the address instead.");
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const found = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (found) return go(found, true);
          setError("We couldn't match your location to an address. Type it instead.");
        } catch {
          setError("Address lookup is unavailable right now. Type it instead.");
        } finally {
          setBusy(null);
        }
      },
      () => {
        setBusy(null);
        setError("We couldn't get your location. Type the address instead.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  return (
    <div className="mt-6 w-full max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="relative"
      >
        <div className="flex h-14 items-center gap-2 rounded-full bg-white pl-4 pr-1.5 text-neutral-900 shadow-lg">
          <MapPin className="h-5 w-5 shrink-0 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => type(e.target.value)}
            placeholder="Enter your address"
            autoComplete="street-address"
            aria-label="Your address"
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500"
          />
          <button
            type="submit"
            aria-label="Book a free evaluation at this address"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6d3c] text-white hover:bg-[#25572f]"
          >
            {busy === "search" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
          </button>
        </div>
        {suggestions.length > 0 && (
          <ul className="absolute inset-x-0 top-16 z-10 overflow-hidden rounded-2xl bg-white text-left text-neutral-900 shadow-xl">
            {suggestions.slice(0, 5).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => go(s, false)} className="flex w-full items-start gap-2 px-4 py-3 text-sm hover:bg-neutral-100">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  {s.fullAddress}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {error && <p className="mt-3 rounded-full bg-white/95 px-4 py-1.5 text-sm font-medium text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Link href="/my" className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-neutral-900 shadow hover:bg-neutral-100">
          <UserRound className="h-3.5 w-3.5" /> Sign in to your project
        </Link>
        <button
          type="button"
          onClick={locate}
          disabled={busy === "locate"}
          className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-neutral-900 shadow hover:bg-neutral-100 disabled:opacity-70"
        >
          {busy === "locate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />} Use current location
        </button>
      </div>
    </div>
  );
}
