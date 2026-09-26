"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, Loader2, LocateFixed, MapPin, Search, UserCheck, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { publicEnv, isMapboxConfigured } from "@/lib/public-env";
import { reverseGeocode, searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { recordBookingVisit, recordLocateResult, submitPublicBooking } from "@/lib/actions/public-booking-actions";
import { assignedVariant, type AddressEntry, type AddressVariant } from "@/lib/booking-test";
import type { AvailableSlotGroup } from "@/lib/booking-availability";
import type { PublicService } from "@/lib/data/public-booking";
import type { BookingTimes, OfferedTime } from "@/app/book/times/route";
import { RecommendedTimes } from "@/components/booking/recommended-times";
import { LandingCard } from "@/components/booking/landing-card";
import { BOOKING_PAGES, NO_PROOF, type BookingProof } from "@/lib/booking-proof";
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
 * **Then who they are, then when.** Four pages: the landing card asks where
 * the property is, the next asks for a name, email and phone, the next for a
 * time, and the last says they are booked. What they want done is not asked
 * at all: the pre-evaluation form after booking asks it properly, and asking
 * twice is a page somebody gives up on.
 *
 * **A time is picked, then confirmed.** Tapping a time only chooses it, so a
 * slip of the thumb on a phone is not a booking.
 */

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
/** The phone the owner's preview of the landing card stands in for. */
const PREVIEW_SCREEN_PX = 680;

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
  noticeText = "",
  linkRef,
  linkOrg,
  referralCode,
  proof = NO_PROOF,
  service = null,
  preview = false,
}: {
  organizationId: string;
  organizationName: string;
  referredByProfileId: string | null;
  services: PublicService[];
  slots: AvailableSlotGroup[];
  /** "The earliest visit is tomorrow." Said before they look for today. */
  noticeText?: string;
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
  /** The reviews and news story the landing card shows. */
  proof?: BookingProof;
  /** The work the person asked about, from the link they came through. */
  service?: string | null;
  /**
   * The owner looking, not a client booking. Every page can be clicked to
   * straight from the arrows, nothing is recorded, and nothing books.
   */
  preview?: boolean;
}) {
  // 0 is the landing card with the address; 1 is who they are; 2 is when.
  // Booked is the fourth page. What they want done is asked afterwards, on
  // the pre-evaluation form, so it is not asked here.
  const [step, setStep] = useState(0);
  // The preview can show the page a client sees once they have booked.
  const [previewDone, setPreviewDone] = useState(false);
  const [booked, setBooked] = useState<{
    date: string;
    time: string;
    address: string;
    digital: boolean;
    prepToken: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const today = new Date();
  const [monthCursor, setMonthCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlotGroup | null>(null);
  // A preview has no address, so no suggested times: straight to the calendar.
  const [showAllTimes, setShowAllTimes] = useState(preview);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<GeocodeSuggestion | null>(null);
  // The address test. Dealt once per browser and kept, so the same person
  // sees the same form every time. The visit is recorded once the form is
  // up, and the booking points back at it.
  const [variant] = useState<AddressVariant>(() => assignedVariant(typeof window === "undefined" ? null : window.localStorage));
  const [addressEntry, setAddressEntry] = useState<AddressEntry>("typed");
  const [locating, setLocating] = useState(false);
  const visitIdRef = useRef<string | null>(null);
  const visitRecordedRef = useRef(false);
  useEffect(() => {
    if (visitRecordedRef.current || preview) return;
    visitRecordedRef.current = true;
    recordBookingVisit({ organizationId, variant, referralCode, linkRef })
      .then((r) => {
        visitIdRef.current = r.visitId;
      })
      .catch(() => {});
  }, [organizationId, variant, referralCode, linkRef, preview]);

  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the comment was about, carried to the booking so the evaluator
  // knows before the pre-evaluation form is back.
  const askedAbout = service ? services.find((s) => s.name.toLowerCase() === service.toLowerCase()) ?? null : null;

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

  /**
   * The ranked times for one address.
   *
   * Called from the two places an address actually becomes settled — picking a
   * suggestion, and reusing a remembered one — rather than from an effect
   * watching the coordinates. Both of those are events, and an effect that
   * fetches on a state change it could have been told about directly is a
   * render that has to happen before the work can start.
   *
   * The coordinates are arguments rather than read off state, because the
   * handler that has them has not re-rendered yet.
   */
  const loadTimes = useCallback(
    async (lat: number, lng: number) => {
      setTimesLoading(true);
      try {
        const query = new URLSearchParams();
        if (linkRef) query.set("ref", linkRef);
        if (linkOrg) query.set("org", linkOrg);
        query.set("lat", String(lat));
        query.set("lng", String(lng));
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
    },
    [linkRef, linkOrg]
  );

  function noteLocate(result: "tapped" | "accepted" | "declined" | "failed") {
    const id = visitIdRef.current;
    if (id) void recordLocateResult({ visitId: id, result }).catch(() => {});
  }

  /**
   * "Use my location": the phone's fix, turned into a street address, shown
   * to accept or decline. Never written in without the person agreeing to
   * it, because a fix is good to a house or two and the wrong house is a
   * wasted trip.
   */
  function useMyLocation() {
    setError(null);
    noteLocate("tapped");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      noteLocate("failed");
      return setError("Your browser can't share your location. Type the address instead.");
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const found = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (!found) {
            noteLocate("failed");
            setError("We couldn't match your location to an address. Type it instead.");
            return;
          }
          setSelectedAddress(found);
          setAddressQuery(found.fullAddress);
          setSuggestions([]);
          setAddressEntry("located");
          void loadTimes(found.lat, found.lng);
          // Straight on; the next page shows the address with a way to change it.
          setStep(1);
        } catch {
          noteLocate("failed");
          setError("Address lookup is unavailable right now. Type it instead.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        noteLocate("failed");
        setError("We couldn't get your location. Type the address instead.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  function handleAddressQueryChange(value: string) {
    setAddressQuery(value);
    setSelectedAddress(null);
    setAddressEntry("typed");
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
    void loadTimes(saved.lat, saved.lng);
  }

  function forgetRemembered() {
    // Both, deliberately. Clearing the store is the real thing; the flag
    // covers a browser that refuses to forget, so the card still goes away
    // when somebody says it is not their house.
    setDismissedMemory(true);
    forgetMemory();
  }

  /** An address picked from the search: straight on to who they are. */
  function pickAddress(found: GeocodeSuggestion) {
    setSelectedAddress(found);
    setAddressQuery(found.fullAddress);
    setSuggestions([]);
    setError(null);
    void loadTimes(found.lat, found.lng);
    setStep(1);
  }

  /** Back to the first page to pick another address. */
  function changeAddress() {
    if (addressEntry === "located") noteLocate("declined");
    setSelectedAddress(null);
    setAddressQuery("");
    setAddressEntry("typed");
    setTimes(null);
    setSelectedSlot(null);
    setStep(0);
  }

  /** Who they are, checked before the times. */
  function detailsProblem(): string | null {
    if (!firstName.trim() || !lastName.trim()) return "Enter your first and last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (!phone.trim()) return "Enter a phone number.";
    return null;
  }

  function handleSubmit() {
    setError(null);
    if (preview) return setError("This is a preview, so nothing is booked.");
    const problem = detailsProblem();
    if (problem) {
      setStep(1);
      return setError(problem);
    }
    if (!selectedAddress || !selectedSlot) return setError("Pick a time first.");
    if (addressEntry === "located") noteLocate("accepted");

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
          requestedServiceTypeIds: askedAbout ? [askedAbout.service_type_id] : [],
          referralCode,
          bookingVariant: variant,
          addressEntry,
          visitId: visitIdRef.current,
          notes: service ? `Asked about ${service} in the post we answered.` : "",
          // Not asked any more: the pre-evaluation form covers what they want.
          budgetRange: "Not sure yet",
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
          prepToken: result.prepToken ?? null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
      }
    });
  }

  // What a client sees once they have booked. The preview shows it with a
  // made-up time, so the owner can see the last page too.
  const done =
    booked ??
    (preview && previewDone
      ? {
          date: toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2)),
          time: "10:00",
          address: "123 Example Rd, Bel Air, MD",
          digital: false,
          prepToken: null,
        }
      : null);
  const doneEmail = booked ? email : "you@example.com";

  // Shadows the state on purpose: the preview's made-up booking reads the same.
  function renderDone(booked: NonNullable<typeof done>) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        {pageCounter(BOOKING_PAGES.length - 1)}
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold">You&apos;re booked</h1>
        <p className="text-muted-foreground">
          {formatDateHeader(booked.date)} at {formatTimeLabel(booked.time)}, at {booked.address}.
        </p>
        {/* The one thing left to do, and the reason the booking asked so little. */}
        {(booked.prepToken || preview) && (
          <div className="w-full rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-left text-sm">
            <p className="font-semibold">Next: tell us what you&apos;d like done</p>
            <p className="mt-1 text-muted-foreground">
              A short pre-evaluation form: what you want done, the looks you like and anything that would give you pause.
              About five minutes, and we come with ideas.
            </p>
            <a
              href={booked.prepToken ? `/prep/${booked.prepToken}` : undefined}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
            >
              Fill in the pre-evaluation form
            </a>
          </div>
        )}
        <div className="w-full rounded-xl border border-border bg-card p-4 text-left text-sm">
          <p className="font-medium">What happens next</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
            <li>A confirmation is on its way to {doneEmail}.</li>
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
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+2f6d3c(${selectedAddress.lng},${selectedAddress.lat})/${selectedAddress.lng},${selectedAddress.lat},19,0/480x320@2x?access_token=${publicEnv.mapboxToken}`
      : null;

  // Whether somebody is driving to this one. Worked out in the browser purely
  // so the client can be told before they commit; what gets written down is
  // decided again on the server, from the same coordinates.
  const mode = selectedAddress ? modeForAddress(selectedAddress.lat, selectedAddress.lng, selectedAddress.fullAddress) : null;

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

  // Picking a time only chooses it; the confirm button books it, so a
  // mis-tap on a phone is not a booking.
  function pickOffered(offer: OfferedTime) {
    setSelectedSlot({ date: offer.date, time: offer.time, evaluatorIds: offer.evaluatorIds });
    setSelectedDate(offer.date);
    setError(null);
  }

  const pageCount = BOOKING_PAGES.length;
  // Where the preview arrows can go: every page, the booked one last.
  const previewAt = previewDone ? pageCount - 1 : step;
  function previewGo(index: number) {
    setError(null);
    if (index >= pageCount - 1) {
      setPreviewDone(true);
      return;
    }
    setPreviewDone(false);
    setStep(Math.max(0, index));
  }

  /** "Page 2 of 4 · Your details", and the dots. */
  function pageCounter(at: number) {
    return (
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          Page {at + 1} of {pageCount}
          {at > 0 ? ` · ${BOOKING_PAGES[at]}` : ""}
        </span>
        <span className="flex gap-1" aria-hidden>
          {BOOKING_PAGES.map((label, i) => (
            <span key={label} className={cn("h-1.5 w-5 rounded-full", i <= at ? "bg-primary" : "bg-muted")} />
          ))}
        </span>
      </div>
    );
  }

  // The landing card is one screen, nothing to scroll: the page is exactly
  // the height of the phone, and the card sizes its before-and-after to fit.
  const landing = !done && step === 0;

  // Where the booking starts, on the landing card: the address search. The
  // suggestions drop down over the card rather than push it, so it stays one
  // screen.
  const addressSearch = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="address" className="text-sm font-semibold">
        Where is the property?
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="address"
          value={addressQuery}
          onChange={(e) => handleAddressQueryChange(e.target.value)}
          placeholder="Start typing your address"
          disabled={!isMapboxConfigured}
          className="h-12 border-primary/50 pl-10 pr-10 text-base"
          autoComplete="off"
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          variant === "tap" &&
          isMapboxConfigured && (
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-primary hover:bg-accent"
              aria-label="Use my location"
              title="Use my location"
            >
              {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
            </button>
          )
        )}
        {suggestions.length > 0 && !selectedAddress && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pickAddress(s)}
                className="flex min-h-12 w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-accent"
              >
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                {s.fullAddress}
              </button>
            ))}
          </div>
        )}
      </div>
      {remembered && !dismissedMemory && !selectedAddress && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <UserCheck className="h-3.5 w-3.5 text-primary" />
          <button type="button" className="font-medium text-primary underline" onClick={() => applyRemembered(remembered)}>
            Book again at {summarise(remembered).address}
          </button>
          <button type="button" className="underline" onClick={forgetRemembered}>
            Not me
          </button>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col gap-3 px-4",
        landing && !preview ? "h-[100dvh] py-3" : "py-6 sm:py-10"
      )}
    >
      {preview && (
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-primary/50 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Eye className="h-3.5 w-3.5" /> Preview · {pageCount} pages
            </p>
            <span className="flex gap-1">
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={previewAt === 0} onClick={() => previewGo(previewAt - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={previewAt >= pageCount - 1}
                onClick={() => previewGo(previewAt + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {BOOKING_PAGES.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => previewGo(i)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px]",
                  i === previewAt ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                )}
              >
                {i + 1}. {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        data-booking-card
        className={cn(
          "flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5",
          // Its own height, never squeezed by the page: the landing card works
          // out how big its before-and-after can be from that.
          landing && "shrink-0 gap-3"
        )}
      >
      {done ? (
        renderDone(done)
      ) : (
      <>
      {/* Which page of how many, so nobody wonders how long this goes on. */}
      {pageCounter(step)}

      {/* ------------------------------------------- 1. welcome, and where */}
      {step === 0 && (
        <LandingCard
          organizationName={organizationName}
          service={service}
          proof={proof}
          start={addressSearch}
          // The owner's preview stands in for a phone of this height.
          fitHeight={preview ? PREVIEW_SCREEN_PX : null}
        />
      )}

      {/* ------------------------------------------------- 2. who they are */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-border p-2">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Satellite view with a pin on the property" className="h-16 w-20 shrink-0 rounded-lg object-cover" />
            ) : (
              <MapPin className="m-2 h-5 w-5 shrink-0 text-primary" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{selectedAddress?.fullAddress ?? "No address yet"}</p>
              <button type="button" onClick={changeAddress} className="text-xs text-primary underline">
                Not this one? Change it
              </button>
            </div>
          </div>
          <p className="font-medium">Where do we send the confirmation?</p>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                const problem = preview ? null : detailsProblem();
                if (problem) return setError(problem);
                setError(null);
                setStep(2);
              }}
            >
              See open times
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">We won&apos;t pass your details to anyone.</p>
        </div>
      )}

      {/* ------------------------------------------------------- 3. the time */}
      {step === 2 && (
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
              {noticeText && ` ${noticeText}`}
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
            <div className="flex flex-col gap-4">
              <div>
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
                  {timesForSelectedDate.map((slot) => {
                    const chosen = selectedSlot?.date === slot.date && selectedSlot?.time === slot.time;
                    return (
                      <button
                        key={`${slot.date}T${slot.time}`}
                        type="button"
                        onClick={() => {
                          setSelectedSlot(slot);
                          setError(null);
                        }}
                        className={cn(
                          "min-h-11 rounded-lg border px-3 text-sm font-medium",
                          chosen ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary hover:bg-accent"
                        )}
                      >
                        {formatTimeLabel(slot.time)}
                      </button>
                    );
                  })}
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

          <Button type="button" className="h-12 w-full text-base" disabled={isPending || preview || !selectedSlot} onClick={handleSubmit}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Booking…
              </>
            ) : selectedSlot ? (
              `Confirm ${formatDateHeader(selectedSlot.date)} at ${formatTimeLabel(selectedSlot.time)}`
            ) : (
              "Pick a time above"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Free, and no obligation.</p>
          <Button type="button" variant="outline" className="self-start" onClick={() => setStep(1)} disabled={isPending}>
            Back
          </Button>
        </div>
      )}
      </>
      )}
      </div>
    </div>
  );
}
