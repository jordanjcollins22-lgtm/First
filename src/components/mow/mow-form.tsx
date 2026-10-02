"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2, Lock, MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LotPicker } from "@/components/intake/lot-picker";
import { searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { mowQuote, startMowOrder, type MowQuote } from "@/lib/actions/public-mow-actions";

type Quote = Extract<MowQuote, { ok: true }>;

/**
 * Three steps on one screen, each appearing under the last: where, how much,
 * who. The price comes from their own lot, and they can move it a size up or
 * down if the picture is wrong, because they know their lawn better than the
 * county does.
 */
export function MowForm({
  orgSlug,
  rec,
  preview,
}: {
  orgSlug: string | null;
  rec: string | null;
  /** Opens on a price already found. Only for previewing the page. */
  preview?: { address: string; quote: Quote };
}) {
  const [address, setAddress] = useState(preview?.address ?? "");
  const [picked, setPicked] = useState<GeocodeSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [quote, setQuote] = useState<Quote | null>(preview?.quote ?? null);
  const [tier, setTier] = useState<string | null>(preview?.quote.tier ?? null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [looking, startLooking] = useTransition();
  const [paying, startPaying] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onAddress(value: string) {
    setAddress(value);
    setPicked(null);
    setQuote(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (value.trim().length < 4) return setSuggestions([]);
    debounce.current = setTimeout(async () => {
      try {
        setSuggestions(await searchAddress(value));
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }

  function lookUp(chosen?: GeocodeSuggestion) {
    const where = chosen ?? picked;
    const text = chosen?.fullAddress ?? address;
    setError(null);
    startLooking(async () => {
      const result = await mowQuote({ address: text, lat: where?.lat ?? null, lng: where?.lng ?? null });
      if (!result.ok) return setError(result.message);
      setQuote(result);
      setTier(result.tier);
    });
  }

  function choose(s: GeocodeSuggestion) {
    setAddress(s.fullAddress);
    setPicked(s);
    setSuggestions([]);
    lookUp(s);
  }

  const tiers = quote?.tiers ?? [];
  const index = tiers.findIndex((t) => t.key === tier);
  const current = index >= 0 ? tiers[index] : null;

  function pay() {
    if (!quote || !current) return;
    setError(null);
    startPaying(async () => {
      const result = await startMowOrder({
        orgSlug,
        name,
        email,
        phone,
        address,
        lat: quote.lat,
        lng: quote.lng,
        tier: current.key,
        estimatedTier: quote.tier,
        lotSqft: quote.lotSqft,
        lawnSqft: quote.lawnSqft,
        rec,
      });
      if (!result.ok) return setError(result.message);
      window.location.href = result.url;
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6d3c]">
          <Image src="/logo-mark.png" alt="" width={28} height={28} className="h-7 w-7" priority />
        </span>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">JS Landscaping MD</p>
          <h1 className="text-xl font-bold leading-tight">Get your lawn mowed</h1>
        </div>
      </header>

      <section className="rounded-2xl bg-[#2f6d3c] px-4 py-3 text-white">
        <p className="text-sm font-semibold">Last-minute openings: 15% off your first mow</p>
        <p className="text-xs text-white/80">Type your address for your price. Takes about a minute.</p>
      </section>

      {/* 1. Where */}
      <section className="flex flex-col gap-2">
        <label htmlFor="mow-address" className="text-sm font-semibold">
          Your address
        </label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="mow-address"
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookUp()}
            autoComplete="street-address"
            placeholder="Start typing and pick yours"
            className="h-12 pl-9 text-base"
          />
        </div>
        {suggestions.length > 0 && !picked && (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {suggestions.slice(0, 4).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => choose(s)} className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent">
                  {s.fullAddress}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!quote && (
          <Button type="button" className="h-12 text-base font-semibold" disabled={looking || address.trim().length < 6} onClick={() => lookUp()}>
            {looking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            {looking ? "Finding your property" : "See my price"}
          </Button>
        )}
      </section>

      {/* 2. How much */}
      {quote && (
        <section className="flex flex-col gap-3">
          {quote.lot ? (
            <>
              <LotPicker lot={quote.lot} picked={["whole"]} readOnly caption="Your property line from the county records." />
              <p className="text-sm text-muted-foreground">
                {quote.lawnSqft
                  ? `Your lot is about ${quote.lotSqft?.toLocaleString("en-US")} sq ft. Leaving out the house, driveway and beds, that's about ${quote.lawnSqft.toLocaleString("en-US")} sq ft of lawn.`
                  : "Here's your property."}
              </p>
            </>
          ) : (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
              We couldn&apos;t find your lot on the county map, so pick the size that looks right. We&apos;ll check it when we call.
            </p>
          )}

          {quote.overAcre ? (
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              <p className="font-semibold">That&apos;s more than an acre of lawn</p>
              <p className="mt-1 text-muted-foreground">Bigger properties get a price from a person. Book a free visit and we&apos;ll quote it.</p>
              <a href={rec ? `/book?rec=${rec}` : "/book"} className="mt-3 inline-block font-semibold text-primary underline">
                Book a free visit
              </a>
            </div>
          ) : current ? (
            <div className="rounded-2xl border-2 border-primary bg-card p-4">
              <p className="text-sm font-semibold">{current.label}</p>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-4xl font-black text-primary tabular-nums">{current.firstMow}</span>
                <span className="text-lg text-muted-foreground line-through tabular-nums">{current.regular}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{quote.discountPercent}% off</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                First mow. After that, {current.regular} a mow.
              </p>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={index <= 0} onClick={() => setTier(tiers[index - 1].key)}>
                  <ChevronDown className="mr-1 h-4 w-4" /> My lawn is smaller
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={index >= tiers.length - 1} onClick={() => setTier(tiers[index + 1].key)}>
                  <ChevronUp className="mr-1 h-4 w-4" /> Bigger
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {tiers.map((t) => (
                <button key={t.key} type="button" onClick={() => setTier(t.key)} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-primary/50">
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="text-sm">
                    <span className="font-bold text-primary">{t.firstMow}</span> <span className="text-muted-foreground line-through">{t.regular}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3. Who, and pay */}
      {quote && current && !quote.overAcre && (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Reserve your spot</h2>
          <Input placeholder="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          <Input placeholder="Phone (we'll call to set your day)" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" />
          <Input placeholder="Email for your receipt" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          <Button type="button" className="h-12 text-base font-semibold" disabled={paying} onClick={pay}>
            {paying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
            Pay {current.firstMow} and reserve my spot
          </Button>
          <p className="text-center text-xs text-muted-foreground">Secure card payment. A team member will call within 24 hours to set your mowing day.</p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
