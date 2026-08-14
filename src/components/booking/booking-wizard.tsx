"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, MapPin, Search } from "lucide-react";

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

const STEP_LABELS = ["Your info", "Confirm home", "What you need", "Budget", "Schedule"];

function formatDateHeader(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function BookingWizard({
  organizationId,
  organizationName,
  referredByProfileId,
  services,
  slots,
}: {
  organizationId: string;
  organizationName: string;
  referredByProfileId: string | null;
  services: PublicService[];
  slots: AvailableSlotGroup[];
}) {
  const [step, setStep] = useState(1);
  const [booked, setBooked] = useState<{ date: string; time: string; address: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlotGroup | null>(null);

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

  function goToStep1Details() {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) return setError("Enter your first and last name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!phone.trim()) return setError("Enter a phone number.");
    if (!selectedAddress) return setError("Select your address from the search results.");
    setStep(2);
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
    if (!selectedAddress || !selectedSlot) return;
    setError(null);
    startTransition(async () => {
      try {
        await submitPublicBooking({
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
          notes,
          budgetRange,
        });
        setBooked({ date: selectedSlot.date, time: selectedSlot.time, address: selectedAddress.fullAddress });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
      }
    });
  }

  if (booked) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold">You&apos;re booked!</h1>
        <p className="text-muted-foreground">
          We&apos;ll see you {formatDateHeader(booked.date)} at {formatTimeLabel(booked.time)} at {booked.address}.
        </p>
        <p className="text-sm text-muted-foreground">A confirmation will be sent to {email}.</p>
      </div>
    );
  }

  const imageUrl =
    selectedAddress && isMapboxConfigured
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+2f6d3c(${selectedAddress.lng},${selectedAddress.lat})/${selectedAddress.lng},${selectedAddress.lat},19,0/480x320@2x?access_token=${env.mapboxToken}`
      : null;

  const slotsByDate = new Map<string, AvailableSlotGroup[]>();
  for (const slot of slots) {
    const list = slotsByDate.get(slot.date) ?? [];
    list.push(slot);
    slotsByDate.set(slot.date, list);
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-bold">{organizationName}</h1>
        <p className="text-sm text-muted-foreground">Book your free property evaluation.</p>
      </div>

      <div className="flex items-center gap-1">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                "h-1.5 w-full rounded-full",
                i + 1 <= step ? "bg-primary" : "bg-muted"
              )}
            />
            <span className={cn("text-[10px]", i + 1 === step ? "font-semibold text-primary" : "text-muted-foreground")}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-12 text-base" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-12 text-base" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address">Property address</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="address"
                value={addressQuery}
                onChange={(e) => handleAddressQueryChange(e.target.value)}
                placeholder="123 Main St, Charlotte, NC"
                disabled={!isMapboxConfigured}
                className="h-12 pl-10 text-base"
                autoComplete="off"
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {suggestions.length > 0 && !selectedAddress && (
              <div className="rounded-lg border border-border bg-card shadow-sm">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedAddress(s);
                      setAddressQuery(s.fullAddress);
                      setSuggestions([]);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-accent"
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {s.fullAddress}
                  </button>
                ))}
              </div>
            )}
            {selectedAddress && (
              <p className="flex items-center gap-1 text-sm text-primary">
                <MapPin className="h-4 w-4" /> {selectedAddress.fullAddress}
              </p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" size="xl" onClick={goToStep1Details}>
            Next
          </Button>
        </div>
      )}

      {step === 2 && selectedAddress && (
        <div className="flex flex-col gap-4">
          <p className="font-medium">Is this your home?</p>
          {imageUrl && (
            <div className="overflow-hidden rounded-lg border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Satellite view of your address with a pin on the property" className="h-64 w-full object-cover" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">{selectedAddress.fullAddress}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>
              No, let me fix it
            </Button>
            <Button type="button" className="flex-1" onClick={() => setStep(3)}>
              Yes, that&apos;s it
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <p className="font-medium">What would you like done?</p>
          <div className="flex flex-col gap-2">
            {services.map((service) => (
              <label
                key={service.service_type_id}
                className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm hover:bg-accent/50"
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
            <Label htmlFor="notes">Anything else you&apos;d like us to know?</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                if (selectedServiceIds.size === 0 && !notes.trim()) {
                  setError("Select at least one service, or tell us what you need.");
                  return;
                }
                setError(null);
                setStep(4);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <p className="font-medium">What&apos;s your budget range?</p>
          <div className="flex flex-col gap-2">
            {BUDGET_RANGES.map((range) => (
              <label
                key={range}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-sm",
                  budgetRange === range ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50"
                )}
              >
                <input
                  type="radio"
                  name="budgetRange"
                  checked={budgetRange === range}
                  onChange={() => setBudgetRange(range)}
                  className="h-4 w-4"
                />
                {range}
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                if (!budgetRange) return setError("Select a budget range.");
                setError(null);
                setStep(5);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-4">
          <p className="font-medium">Pick a date and time</p>
          {slotsByDate.size === 0 ? (
            <p className="text-sm text-muted-foreground">No openings in the next two weeks — please contact us directly.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {Array.from(slotsByDate.entries()).map(([date, daySlots]) => (
                <div key={date}>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{formatDateHeader(date)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {daySlots.map((slot) => (
                      <button
                        key={`${slot.date}T${slot.time}`}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-xs font-medium",
                          selectedSlot?.date === slot.date && selectedSlot?.time === slot.time
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card hover:bg-accent"
                        )}
                      >
                        {formatTimeLabel(slot.time)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(4)} disabled={isPending}>
              Back
            </Button>
            <Button type="button" className="flex-1" disabled={!selectedSlot || isPending} onClick={handleSubmit}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Booking...
                </>
              ) : (
                "Confirm my evaluation"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
