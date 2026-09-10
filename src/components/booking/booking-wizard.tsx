"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { CheckCircle2, Loader2, MapPin, Search, UserCheck, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { env, isMapboxConfigured } from "@/lib/env";
import { searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { submitPublicBooking } from "@/lib/actions/public-booking-actions";
import { BUDGET_RANGES } from "@/lib/booking-budget-ranges";
import type { AvailableSlotGroup } from "@/lib/booking-availability";
import type { PublicService } from "@/lib/data/public-booking";
import type { BookingTimes, OfferedTime } from "@/app/book/times/route";
import { RecommendedTimes } from "@/components/booking/recommended-times";
import { modeForAddress } from "@/lib/evaluation-mode";
import {
  MEMORY_KEY,
  readRemembered,
  rememberBooking,
  summarise,
  type RememberedBooking,
} from "@/lib/booking-memory";

/**
 * Booking a free evaluation, in the order somebody is willing to answer.
 *
 * The form used to open on a calendar and ask for a name, an email and a phone
 * number at step two — before the person had committed to anything, and before
 * we knew enough to be useful to them. Everything about this version follows
 * from turning that around.
 *
 * **The address comes first.** It is the least personal thing we need, it reads
 * as "check whether you cover me" rather than as a form, and it is the one
 * answer that makes everything after it better: once we know where the property
 * is, the server can work out which free hours sit next to an evaluation
 * already booked nearby and offer those. The client gets a shorter wait, we get
 * a tighter round, and neither of us had to think about it.
 *
 * **Contact details come last.** By then somebody has picked a property, told
 * us what they want doing and chosen a time. Asking for a phone number at that
 * point is the last small step of something already begun, rather than the
 * price of starting.
 *
 * **Nothing dead-ends.** The budget question used to refuse to submit without a
 * bracket, so anybody who genuinely did not know lost the booking on the final
 * click. "Not sure yet" is now an answer.
 */

const STEP_LABELS = ["Your place", "What you need", "When", "Your details"];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateHeader(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The remembered booking, as an external store.
 *
 * Module level so the function identities never change between renders, which
 * is what useSyncExternalStore needs to avoid resubscribing on every one.
 */
const MEMORY_EVENT = "booking-memory";

function subscribeToMemory(onChange: () => void): () => void {
  // "storage" covers another tab; the custom event covers this one, which
  // does not fire "storage" for its own writes.
  window.addEventListener("storage", onChange);
  window.addEventListener(MEMORY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(MEMORY_EVENT, onChange);
  };
}

function memorySnapshot(): string | null {
  try {
    return window.localStorage.getItem(MEMORY_KEY);
  } catch {
    // A browser refusing storage is a browser that gets the plain form.
    return null;
  }
}

/** Nothing, on the server. The card appears at hydration or not at all. */
function serverMemorySnapshot(): string | null {
  return null;
}

function writeMemory(value: string): void {
  try {
    window.localStorage.setItem(MEMORY_KEY, value);
    window.dispatchEvent(new Event(MEMORY_EVENT));
  } catch {
    // The booking still happened, which is the point.
  }
}

function forgetMemory(): void {
  try {
    window.localStorage.removeItem(MEMORY_KEY);
    window.dispatchEvent(new Event(MEMORY_EVENT));
  } catch {
    // Nothing to do.
  }
}

export function BookingWizard({
  organizationId,
  organizationName,
  referredByProfileId,
  services,
  slots,
  linkRef,
  linkOrg,
  referralCode,
}: {
  organizationId: string;
  organizationName: string;
  referredByProfileId: string | null;
  services: PublicService[];
  slots: AvailableSlotGroup[];
  /** The ?ref= and ?org= off the booking link, so the times endpoint resolves the same business. */
  linkRef: string | null;
  linkOrg: string | null;
  /**
   * The ?rec= off the link, when this came through a reply somebody posted.
   *
   * Carried through untouched and handed to the server, which decides whether
   * it is a code we issued. A stranger can put anything in a URL.
   */
  referralCode: string | null;
}) {
  const [step, setStep] = useState(1);
  const [booked, setBooked] = useState<{
    date: string;
    time: string;
    address: string;
    digital: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const today = new Date();
  const [monthCursor, setMonthCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlotGroup | null>(null);
  const [showAllTimes, setShowAllTimes] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<GeocodeSuggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [budgetRange, setBudgetRange] = useState("");

  // The ranked times, worked out on the server once it knows the address.
  const [times, setTimes] = useState<BookingTimes | null>(null);
  const [timesLoading, setTimesLoading] = useState(false);

  // What this browser already knows about whoever is holding it.
  //
  // Subscribed to rather than read into state in an effect. localStorage is an
  // external store and this is the hook for one: the server snapshot is null,
  // so the prerendered page has no card and the client fills it in on
  // hydration without a cascading render. Clearing it in another tab, or in
  // this one, updates the card too.
  const savedRaw = useSyncExternalStore(subscribeToMemory, memorySnapshot, serverMemorySnapshot);
  const remembered = useMemo(() => readRemembered(savedRaw), [savedRaw]);
  const [dismissedMemory, setDismissedMemory] = useState(false);

  const lat = selectedAddress?.lat ?? null;
  const lng = selectedAddress?.lng ?? null;

  const loadTimes = useCallback(async () => {
    setTimesLoading(true);
    try {
      const query = new URLSearchParams();
      if (linkRef) query.set("ref", linkRef);
      if (linkOrg) query.set("org", linkOrg);
      if (lat != null && lng != null) {
        query.set("lat", String(lat));
        query.set("lng", String(lng));
      }
      const response = await fetch(`/book/times?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setTimes((await response.json()) as BookingTimes);
    } catch {
      // The plain list the page already has is a perfectly good fallback: the
      // same hours, just without the "we're nearby" on any of them.
      setTimes(null);
    } finally {
      setTimesLoading(false);
    }
  }, [linkRef, linkOrg, lat, lng]);

  // Fetched when the address is settled rather than on every keystroke.
  useEffect(() => {
    if (lat == null || lng == null) return;
    void loadTimes();
  }, [lat, lng, loadTimes]);

  function handleAddressQueryChange(value: string) {
    setAddressQuery(value);
    setSelectedAddress(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await searchAddress(value));
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  /**
   * Take the details this browser already has and get out of the way.
   *
   * Not a hook, despite what a name starting with "use" would have implied —
   * it is an ordinary click handler, and the old name had the linter treating
   * it as one.
   *
   * Everything the form asks for except what they want doing, filled at once,
   * and straight to the time picker — which is the only part of a second
   * booking that is genuinely a new decision.
   */
  function applyRemembered(saved: RememberedBooking) {
    setFirstName(saved.firstName);
    setLastName(saved.lastName);
    setEmail(saved.email);
    setPhone(saved.phone);
    setAddressQuery(saved.address);
    setSelectedAddress({
      fullAddress: saved.address,
      lat: saved.lat,
      lng: saved.lng,
    } as GeocodeSuggestion);
    setSuggestions([]);
    setError(null);
    setStep(2);
  }

  function forgetRemembered() {
    // Both, deliberately. Clearing the store is the real thing; the flag
    // covers a browser that refuses to forget, so the card still goes away
    // when somebody says it is not their house.
    setDismissedMemory(true);
    forgetMemory();
  }

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) return setError("Enter your first and last name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!phone.trim()) return setError("Enter a phone number.");
    if (!selectedAddress || !selectedSlot) return setError("Pick an address and a time first.");

    startTransition(async () => {
      try {
        const result = await submitPublicBooking({
          organizationId,
          referredByProfileId,
          candidateEvaluatorIds: selectedSlot.evaluatorIds,
          date: selectedSlot.date,
          time: selectedSlot.time,
          firstName,
          lastName,
          email,
          phone,
          address: selectedAddress.fullAddress,
          lat: selectedAddress.lat,
          lng: selectedAddress.lng,
          requestedServiceTypeIds: Array.from(selectedServiceIds),
          referralCode,
          notes,
          // Never blocks the booking. Somebody who has not thought about money
          // yet is still somebody who wants us to come and look.
          budgetRange: budgetRange || "Not sure yet",
        });
        // Kept in their own browser so a second booking is a tap rather than
        // the same four fields typed again on a phone.
        const keep = rememberBooking({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: selectedAddress.fullAddress,
          lat: selectedAddress.lat,
          lng: selectedAddress.lng,
        });
        if (keep) writeMemory(keep);
        setBooked({
          date: selectedSlot.date,
          time: selectedSlot.time,
          address: selectedAddress.fullAddress,
          // What the server decided, not what the browser guessed.
          digital: result.mode === "digital",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
      }
    });
  }

  if (booked) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold">You&apos;re booked</h1>
        <p className="text-muted-foreground">
          {formatDateHeader(booked.date)} at {formatTimeLabel(booked.time)}, at {booked.address}.
        </p>
        <div className="w-full rounded-xl border border-border bg-card p-4 text-left text-sm">
          <p className="font-medium">What happens next</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
            <li>A confirmation is on its way to {email}.</li>
            <li>
              {booked.digital
                ? "We walk the property with you over a video call — about an hour."
                : "We walk the property with you — about an hour."}
            </li>
            <li>You get a written proposal with a fixed price. No obligation.</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          Need to change it? Reply to the confirmation and we&apos;ll move it.
        </p>
      </div>
    );
  }

  const imageUrl =
    selectedAddress && isMapboxConfigured
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+2f6d3c(${selectedAddress.lng},${selectedAddress.lat})/${selectedAddress.lng},${selectedAddress.lat},19,0/480x320@2x?access_token=${env.mapboxToken}`
      : null;

  // Whether somebody is driving to this one. Worked out in the browser purely
  // so the client can be told before they commit; what gets written down is
  // decided again on the server, from the same coordinates.
  const mode = selectedAddress ? modeForAddress(selectedAddress.lat, selectedAddress.lng) : null;

  // The ranked list once the server has answered, the plain one until then.
  const allTimes: AvailableSlotGroup[] = times
    ? times.all.map((t) => ({ date: t.date, time: t.time, evaluatorIds: t.evaluatorIds }))
    : slots;

  const slotsByDate = new Map<string, AvailableSlotGroup[]>();
  for (const slot of allTimes) {
    const list = slotsByDate.get(slot.date) ?? [];
    list.push(slot);
    slotsByDate.set(slot.date, list);
  }
  for (const list of slotsByDate.values()) list.sort((a, b) => a.time.localeCompare(b.time));

  const slotDateKeys = Array.from(slotsByDate.keys()).sort();
  const earliestSlotMonth = slotDateKeys[0] ? parseDateKey(slotDateKeys[0]) : today;
  const latestSlotMonth = slotDateKeys[slotDateKeys.length - 1]
    ? parseDateKey(slotDateKeys[slotDateKeys.length - 1])
    : today;

  const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1)),
  ];
  const canGoPrev = monthStart > new Date(earliestSlotMonth.getFullYear(), earliestSlotMonth.getMonth(), 1);
  const canGoNext = monthStart < new Date(latestSlotMonth.getFullYear(), latestSlotMonth.getMonth(), 1);
  const timesForSelectedDate = selectedDate ? slotsByDate.get(selectedDate) ?? [] : [];

  function pickOffered(offer: OfferedTime) {
    setSelectedSlot({ date: offer.date, time: offer.time, evaluatorIds: offer.evaluatorIds });
    setSelectedDate(offer.date);
    setError(null);
    setStep(4);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      {/* The offer, said plainly and specifically. "Free consultation" is a
          category; this is a thing somebody can picture happening. Every claim
          in it is one the rest of the app actually delivers. */}
      <div>
        <p className="text-sm font-medium text-primary">{organizationName}</p>
        <h1 className="mt-0.5 text-2xl font-bold leading-tight">Book your free property evaluation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We walk your property with you, measure what needs doing, and leave you with a written proposal and a
          fixed price. Takes about an hour. It&apos;s free, and there&apos;s no obligation.
        </p>
      </div>

      <div className="flex items-center gap-1">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div className={cn("h-1.5 w-full rounded-full", i + 1 <= step ? "bg-primary" : "bg-muted")} />
            <span className={cn("text-[10px]", i + 1 === step ? "font-semibold text-primary" : "text-muted-foreground")}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ------------------------------------ 0. we have been here before */}
      {step === 1 && remembered && !dismissedMemory && (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Welcome back — shall we use these?</p>
          </div>
          <div className="text-sm">
            <p className="font-medium">{summarise(remembered).name}</p>
            <p className="text-muted-foreground">{summarise(remembered).address}</p>
            <p className="text-xs text-muted-foreground">{summarise(remembered).contact}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11" onClick={() => applyRemembered(remembered)}>
              Use these details
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={forgetRemembered}>
              Somewhere else
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saved on this device from your last booking. We never see it until you book.
          </p>
        </div>
      )}

      {/* ---------------------------------------------------- 1. the address */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-medium">Where is the property?</p>
            <p className="text-sm text-muted-foreground">
              So we can check we cover you and find the soonest we can get there.
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="address"
              value={addressQuery}
              onChange={(e) => handleAddressQueryChange(e.target.value)}
              placeholder="Start typing your address"
              disabled={!isMapboxConfigured}
              className="h-14 pl-10 text-base"
              autoComplete="off"
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {suggestions.length > 0 && !selectedAddress && (
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedAddress(s);
                    setAddressQuery(s.fullAddress);
                    setSuggestions([]);
                  }}
                  className="flex min-h-12 w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-accent"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {s.fullAddress}
                </button>
              ))}
            </div>
          )}

          {/* Confirming the pin and picking the address are one step now. It
              was two, and the second one asked a person to agree with a
              decision they had just made thirty seconds earlier. */}
          {selectedAddress && (
            <div className="flex flex-col gap-3">
              {imageUrl && (
                <div className="overflow-hidden rounded-xl border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="Satellite view with a pin on the property"
                    className="h-56 w-full object-cover"
                  />
                </div>
              )}
              <p className="flex items-start gap-1.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{selectedAddress.fullAddress}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setSelectedAddress(null);
                    setAddressQuery("");
                    setTimes(null);
                  }}
                >
                  Not this one
                </Button>
                <Button type="button" className="flex-1" onClick={() => setStep(2)}>
                  That&apos;s it — continue
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {/* ------------------------------------------------- 2. what they want */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-medium">What would you like done?</p>
            <p className="text-sm text-muted-foreground">Pick anything that applies — we&apos;ll talk it through on the day.</p>
          </div>
          <div className="flex flex-col gap-2">
            {services.map((service) => (
              <label
                key={service.service_type_id}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-lg border p-3 text-sm",
                  selectedServiceIds.has(service.service_type_id)
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <Checkbox
                  checked={selectedServiceIds.has(service.service_type_id)}
                  onCheckedChange={() => toggleService(service.service_type_id)}
                />
                {service.name}
              </label>
            ))}
            {services.length === 0 && <p className="text-sm text-muted-foreground">Tell us what you need below.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Anything else we should know?</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Dogs in the garden, a gate code, the bit that floods…"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                if (selectedServiceIds.size === 0 && !notes.trim()) {
                  setError("Pick at least one, or tell us what you need.");
                  return;
                }
                setError(null);
                setStep(3);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- 3. the time */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          {/* Which kind of evaluation this address gets, said before they pick
              a time rather than after they have booked one. Somebody two hours
              away should know it is a video call while they still have the
              choice, not discover it in a confirmation email. */}
          {mode?.mode === "digital" && (
            <div className="flex gap-2.5 rounded-lg border border-border bg-accent/40 px-3 py-2.5">
              <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">{mode.says}</p>
            </div>
          )}
          <div>
            <p className="font-medium">When suits you?</p>
            <p className="text-sm text-muted-foreground">
              {times && times.recommended.some((t) => t.says?.includes("close"))
                ? "These work best for us, so they're the ones we can promise."
                : "The soonest we can get to you."}
            </p>
          </div>

          {!showAllTimes ? (
            <RecommendedTimes
              times={times?.recommended ?? []}
              loading={timesLoading && !times}
              selected={selectedSlot}
              onPick={pickOffered}
              onSeeAll={() => setShowAllTimes(true)}
            />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="sm:w-64 sm:shrink-0">
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={!canGoPrev}
                    onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    aria-label="Previous month"
                  >
                    ‹
                  </button>
                  <p className="text-sm font-semibold">{formatMonth(monthStart)}</p>
                  <button
                    type="button"
                    disabled={!canGoNext}
                    onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    aria-label="Next month"
                  >
                    ›
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <div key={i}>{label}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {monthCells.map((date, i) => {
                    if (!date) return <div key={`blank-${i}`} />;
                    const key = toDateKey(date);
                    const hasSlots = slotsByDate.has(key);
                    const isSelected = key === selectedDate;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!hasSlots}
                        onClick={() => {
                          setSelectedDate(key);
                          setSelectedSlot(null);
                        }}
                        className={cn(
                          "flex aspect-square items-center justify-center rounded-md text-xs",
                          !hasSlots && "text-muted-foreground/30",
                          hasSlots && !isSelected && "font-medium text-primary hover:bg-accent",
                          isSelected && "bg-primary font-semibold text-primary-foreground"
                        )}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1">
                <p className="mb-2 text-sm font-semibold">
                  {selectedDate ? formatDateHeader(selectedDate) : "Pick a day with open times"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {timesForSelectedDate.map((slot) => (
                    <button
                      key={`${slot.date}T${slot.time}`}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot);
                        setError(null);
                        setStep(4);
                      }}
                      className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:border-primary hover:bg-accent"
                    >
                      {formatTimeLabel(slot.time)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllTimes(false)}
                  className="mt-3 py-2 text-sm text-muted-foreground underline"
                >
                  Back to the suggested times
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" variant="outline" className="self-start" onClick={() => setStep(2)}>
            Back
          </Button>
        </div>
      )}

      {/* ------------------------------------------------- 4. who they are */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          {selectedSlot && (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="self-start rounded-lg bg-primary/10 px-3 py-2 text-left text-sm text-primary"
            >
              <span className="font-semibold">
                {formatDateHeader(selectedSlot.date)} at {formatTimeLabel(selectedSlot.time)}
              </span>{" "}
              — change
            </button>
          )}
          <p className="font-medium">Last bit — where do we send the confirmation?</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-12 text-base" autoComplete="given-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-12 text-base" autoComplete="family-name" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" autoComplete="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 text-base" autoComplete="tel" />
          </div>

          <div className="flex flex-col gap-2">
            <Label>
              Roughly what were you thinking of spending?{" "}
              <span className="font-normal text-muted-foreground">Optional — it just helps us come prepared.</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {BUDGET_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setBudgetRange(budgetRange === range ? "" : range)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 text-sm",
                    budgetRange === range ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent/50"
                  )}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" className="h-12 w-full text-base" disabled={isPending} onClick={handleSubmit}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Booking…
              </>
            ) : (
              "Confirm my free evaluation"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            No charge, no obligation, and we won&apos;t pass your details to anyone.
          </p>
          <Button type="button" variant="outline" className="self-start" onClick={() => setStep(3)} disabled={isPending}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
