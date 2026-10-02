"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, Loader2, Lock, MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LotPicker } from "@/components/intake/lot-picker";
import { searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { checkServiceArea, mowQuote, startMowOrder, type MowQuote } from "@/lib/actions/public-mow-actions";

type Quote = Extract<MowQuote, { ok: true }>;
type Step = "area" | "details" | "price";

/**
 * Three screens, one question each. First, are you in our area: the address
 * alone. Then, who are you: name, phone, email. Then the price, from their
 * own lot, with the card form a tap away. Their details are saved as the
 * price is shown, so somebody who leaves at the price is still somebody to
 * call. They can move the size up or down if the picture is wrong, because
 * they know their lawn better than the county does.
 */
export function MowForm({
  orgSlug,
  rec,
  preview,
}: {
  orgSlug: string | null;
  rec: string | null;
  /** Opens on a given screen. Only for previewing the page. */
  preview?: { step: Step; address: string; quote?: Quote; name?: string; phone?: string; email?: string };
}) {
  const [step, setStep] = useState<Step>(preview?.step ?? "area");
  const [address, setAddress] = useState(preview?.address ?? "");
  const [picked, setPicked] = useState<GeocodeSuggestion | null>(null);
  const [placed, setPlaced] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [outside, setOutside] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(preview?.quote ?? null);
  const [tier, setTier] = useState<string | null>(preview?.quote?.tier ?? null);
  const [name, setName] = useState(preview?.name ?? "");
  const [phone, setPhone] = useState(preview?.phone ?? "");
  const [email, setEmail] = useState(preview?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onAddress(value: string) {
    setAddress(value);
    setPicked(null);
    setOutside(false);
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

  function check(chosen?: GeocodeSuggestion) {
    const where = chosen ?? picked;
    const text = chosen?.fullAddress ?? address;
    setError(null);
    setOutside(false);
    start(async () => {
      const result = await checkServiceArea({ address: text, lat: where?.lat ?? null, lng: where?.lng ?? null });
      if (!result.ok) return setError(result.message);
      if (result.inArea === false) return setOutside(true);
      setPlaced(result.lat != null && result.lng != null ? { lat: result.lat, lng: result.lng } : null);
      setStep("details");
    });
  }

  function choose(s: GeocodeSuggestion) {
    setAddress(s.fullAddress);
    setPicked(s);
    setSuggestions([]);
    check(s);
  }

  const detailsReady = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10 && email.includes("@");

  function getPrice() {
    setError(null);
    start(async () => {
      const result = await mowQuote({ orgSlug, name, email, phone, address, lat: placed?.lat ?? null, lng: placed?.lng ?? null, rec });
      if (!result.ok) return setError(result.message);
      setQuote(result);
      setTier(result.tier);
      setStep("price");
    });
  }

  const tiers = quote?.tiers ?? [];
  const index = tiers.findIndex((t) => t.key === tier);
  const current = index >= 0 ? tiers[index] : null;

  function pay() {
    if (!quote || !current) return;
    setError(null);
    start(async () => {
      const result = await startMowOrder({ orderId: quote.orderId, tier: current.key });
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
          <p className="text-sm font-semibold">Lawn mowing · 15% off your first mow</p>
        </div>
      </header>

      {/* 1. Are you in our area? */}
      {step === "area" && (
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold leading-tight">Let&apos;s check if you&apos;re in our service area</h1>
          <p className="text-sm text-muted-foreground">Start typing your address and pick it from the list.</p>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="mow-address"
              aria-label="Your address"
              value={address}
              onChange={(e) => onAddress(e.target.value)}
              autoComplete="street-address"
              placeholder="Start typing your address"
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
          <Button type="button" className="h-12 text-base font-semibold" disabled={busy || address.trim().length < 6} onClick={() => check()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            {busy ? "Checking your address" : "Check my address"}
          </Button>
          {outside && (
            <div role="status" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">Sorry, that address is outside our service area.</p>
              <p className="mt-1 text-muted-foreground">We mow in Harford County, Maryland. If that&apos;s wrong, check the address and try again.</p>
            </div>
          )}
        </section>
      )}

      {/* 2. Who are you? */}
      {step === "details" && (
        <section className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p>
              <span className="font-semibold">Good news, we mow at your address.</span>
              <span className="block text-muted-foreground">{address}</span>
            </p>
          </div>
          <h1 className="text-2xl font-bold leading-tight">Where should we send your price?</h1>
          <Input placeholder="Full name" aria-label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-base" />
          <Input placeholder="Phone (we'll call to set your day)" aria-label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 text-base" />
          <Input placeholder="Email for your receipt" aria-label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" />
          <Button type="button" className="h-12 text-base font-semibold" disabled={busy || !detailsReady} onClick={getPrice}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {busy ? "Measuring your lawn" : "See my price"}
          </Button>
          <button type="button" onClick={() => setStep("area")} className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
            <ChevronLeft className="h-4 w-4" /> Change address
          </button>
        </section>
      )}

      {/* 3. The price */}
      {step === "price" && quote && (
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold leading-tight">Here&apos;s your price{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ""}</h1>
          {quote.lot ? (
            <>
              <LotPicker lot={quote.lot} picked={["whole"]} readOnly caption="Your property line from the county records." />
              <p className="text-sm text-muted-foreground">
                {quote.lawnSqft
                  ? `Your lot is about ${quote.lotSqft?.toLocaleString("en-US")} sq ft. Leaving out the house, driveway and beds, that's about ${quote.lawnSqft.toLocaleString("en-US")} sq ft of lawn.`
                  : address}
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
              <p className="mt-1 text-muted-foreground">Bigger properties get a price from a person. We have your details and will call you with one.</p>
            </div>
          ) : current ? (
            <div className="rounded-2xl border-2 border-primary bg-card p-4">
              <p className="text-sm font-semibold">{current.label}</p>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-4xl font-black text-primary tabular-nums">{current.firstMow}</span>
                <span className="text-lg text-muted-foreground line-through tabular-nums">{current.regular}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{quote.discountPercent}% off</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">First mow. After that, {current.regular} a mow.</p>
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

          {current && !quote.overAcre && (
            <>
              <Button type="button" className="h-12 text-base font-semibold" disabled={busy} onClick={pay}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                Pay {current.firstMow} and reserve my spot
              </Button>
              <p className="text-center text-xs text-muted-foreground">Secure card payment. A team member will call within 24 hours to set your mowing day.</p>
            </>
          )}
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
