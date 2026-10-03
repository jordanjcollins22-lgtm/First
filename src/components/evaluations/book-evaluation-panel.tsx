"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { bookEvaluation } from "@/lib/actions/property-actions";

/**
 * Booking an evaluation the way the office actually takes one: on the phone.
 *
 * Every evaluation in this system used to arrive through the client's own
 * booking form, which is the wrong shape for the call that books most of
 * them. Somebody rings, the person answering has the address and a diary, and
 * the only path open to them was to create a property, land on the job page,
 * hunt for the schedule panel, and set a date there. Three screens for one
 * phone call, with the contact, the property and the appointment each typed
 * somewhere different.
 *
 * So it is one form, in the order the conversation happens: who, where, when,
 * who is going. Folded shut by default, because the calendar is what somebody
 * came to this page to look at and a booking form open across the top of it is
 * in the way nine times out of ten.
 */
export function BookEvaluationPanel({
  evaluators,
}: {
  /** Who can be sent. Empty is fine: the office books first and assigns later. */
  evaluators: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [picked, setPicked] = useState<GeocodeSuggestion | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [evaluatorId, setEvaluatorId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ready = name.trim() !== "" && picked != null && startsAt !== "";

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const result = await bookEvaluation({
        customerName: name,
        customerEmail: email || null,
        customerPhone: phone || null,
        address: picked!.fullAddress,
        lat: picked!.lat,
        lng: picked!.lng,
        // A datetime-local value carries no zone, which is correct: the office
        // means the clock on their own wall, and the browser is standing next
        // to it.
        startsAt: new Date(startsAt).toISOString(),
        minutes,
        evaluatorId: evaluatorId || null,
        notes: notes || null,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(result.message);
      setName("");
      setEmail("");
      setPhone("");
      setPicked(null);
      setStartsAt("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <section className="mb-4 rounded-xl border border-white/60 bg-card/60 backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <CalendarPlus className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">Book an evaluation</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? "Close" : "For somebody who rang"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field id="book-name" label="Name" value={name} onChange={setName} />
            <Field id="book-email" label="Email" type="email" value={email} onChange={setEmail} />
            <Field id="book-phone" label="Phone" type="tel" value={phone} onChange={setPhone} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">Address</span>
            {picked ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                <span className="flex-1 truncate text-sm">{picked.fullAddress}</span>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="text-xs text-muted-foreground underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <SatelliteAddressSearch onSelect={setPicked} disabled={pending} />
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="book-when" className="text-xs font-medium">
                When
              </label>
              <input
                id="book-when"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="book-minutes" className="text-xs font-medium">
                How long
              </label>
              <select
                id="book-minutes"
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {[30, 45, 60, 90, 120].map((option) => (
                  <option key={option} value={option}>
                    {option} minutes
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="book-who" className="text-xs font-medium">
                Who is going
              </label>
              <select
                id="book-who"
                value={evaluatorId}
                onChange={(event) => setEvaluatorId(event.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {/* Nobody is a real answer. The office books the time first and
                    works out who is free afterwards more often than not. */}
                <option value="">Decide later</option>
                {evaluators.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="book-notes" className="text-xs font-medium">
              What they said they want
            </label>
            <textarea
              id="book-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="rounded-md border border-border bg-background p-2 text-sm"
              placeholder="Beds out front, and something about the drainage by the shed."
            />
          </div>

          <button
            type="button"
            disabled={!ready || pending}
            onClick={submit}
            className={cn(
              "min-h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground",
              (!ready || pending) && "opacity-50"
            )}
          >
            {pending ? "Booking…" : "Book it"}
          </button>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {done && <p className="text-sm font-medium text-primary">{done}</p>}
        </div>
      )}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
      />
    </div>
  );
}
