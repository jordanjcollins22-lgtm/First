"use client";

import { useRef, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { startSaltOrder, type SaltOffer } from "@/lib/actions/public-salt-actions";
import { MINIMUM_TREATMENTS, PET_NOTE, PRODUCT_NOTE, SURFACE_LABEL, type Surface } from "@/lib/salt";

/**
 * Four questions and a card sheet.
 *
 * Somebody deciding in October whether to prepay a winter is not going to make
 * an account, learn a portal, or come back tomorrow. Every field after the
 * fourth costs bookings, so there are four: who, where, what, and how many.
 *
 * The address box is the only clever thing on the page, and it is clever in
 * one direction only. It offers suggestions so a phone can fill the whole line
 * in one tap, and it accepts whatever is typed if the suggestions are no use.
 * A form that refuses an address it cannot find is a form that loses a sale
 * over a new build.
 *
 * The product note is on the page rather than in terms nobody reads, because
 * "we use calcium chloride, not rock salt" is a reason to buy. Anyone who has
 * had a sidewalk pitted by a previous contractor is looking for exactly that
 * sentence, and burying it wastes it.
 */
export function SaltForm({ offer }: { offer: SaltOffer }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<GeocodeSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [surface, setSurface] = useState<Surface>("both");
  const [petFriendly, setPetFriendly] = useState(false);
  const [treatments, setTreatments] = useState(MINIMUM_TREATMENTS);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const price = offer.prices.find((row) => row.surface === surface);
  const perTreatment = price ? Number(price.perTreatment.replace(/[^0-9.]/g, "")) : 0;
  const total = perTreatment * treatments;

  function onAddress(value: string) {
    setAddress(value);
    setPicked(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        setSuggestions(await searchAddress(value));
      } catch {
        // No suggestions is not an error worth showing. They can type it out.
        setSuggestions([]);
      }
    }, 300);
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await startSaltOrder({
        name,
        email,
        address,
        phone,
        surface,
        petFriendly,
        treatments,
        lat: picked?.lat ?? null,
        lng: picked?.lng ?? null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.href = result.url;
    });
  }

  const ready = name.trim() !== "" && email.includes("@") && address.trim().length > 5;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Salt my walks this winter</h1>
        <p className="text-sm text-muted-foreground">
          Prepay for the season and you are on the route before the first storm. We come out, we
          treat it, and you do not think about it again.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium">Calcium chloride, never rock salt</p>
        <p className="mt-1 text-sm text-muted-foreground">{PRODUCT_NOTE}</p>
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What would you like treated?</legend>
        <div className="grid gap-2">
          {offer.prices.map((row) => (
            <button
              key={row.surface}
              type="button"
              onClick={() => setSurface(row.surface)}
              className={cn(
                "flex items-center justify-between rounded-xl border px-3 py-3 text-left",
                surface === row.surface
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-accent"
              )}
            >
              <span className="text-sm font-medium">{SURFACE_LABEL[row.surface]}</span>
              <span className="text-sm font-semibold tabular-nums">
                {row.perTreatment}
                <span className="ml-1 font-normal text-muted-foreground">a visit</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-2 rounded-xl border border-border p-3">
        <input
          type="checkbox"
          checked={petFriendly}
          onChange={(event) => setPetFriendly(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="text-sm font-medium">
            Pet safe blend
            {offer.petSurcharge ? (
              <span className="ml-1 font-normal text-muted-foreground">
                {offer.petSurcharge} a visit
              </span>
            ) : (
              <span className="ml-1 font-normal text-muted-foreground">no extra charge</span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">{PET_NOTE}</span>
        </span>
      </label>

      <div className="flex flex-col gap-1">
        <label htmlFor="salt-treatments" className="text-sm font-medium">
          How many treatments?
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTreatments((n) => Math.max(MINIMUM_TREATMENTS, n - 1))}
            className="h-11 w-11 rounded-lg border border-border text-lg"
            aria-label="One fewer treatment"
          >
            −
          </button>
          <input
            id="salt-treatments"
            type="number"
            inputMode="numeric"
            min={MINIMUM_TREATMENTS}
            max={40}
            value={treatments}
            onChange={(event) =>
              setTreatments(Math.max(MINIMUM_TREATMENTS, Math.min(40, Number(event.target.value) || MINIMUM_TREATMENTS)))
            }
            className="h-11 flex-1 rounded-lg border border-border bg-background px-3 text-center text-base tabular-nums"
          />
          <button
            type="button"
            onClick={() => setTreatments((n) => Math.min(40, n + 1))}
            className="h-11 w-11 rounded-lg border border-border text-lg"
            aria-label="One more treatment"
          >
            +
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {MINIMUM_TREATMENTS} is the minimum. Most winters here take five or six.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Field
          id="salt-name"
          label="Your name"
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <Field
          id="salt-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Field
          id="salt-phone"
          label="Phone (optional)"
          type="tel"
          value={phone}
          onChange={setPhone}
          autoComplete="tel"
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="salt-address" className="text-sm font-medium">
            Address
          </label>
          <input
            id="salt-address"
            type="text"
            value={address}
            onChange={(event) => onAddress(event.target.value)}
            autoComplete="street-address"
            placeholder="Start typing and pick yours"
            className="h-11 rounded-lg border border-border bg-background px-3 text-base"
          />
          {suggestions.length > 0 && !picked && (
            <ul className="rounded-lg border border-border">
              {suggestions.slice(0, 4).map((suggestion) => (
                <li key={suggestion.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddress(suggestion.fullAddress);
                      setPicked(suggestion);
                      setSuggestions([]);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    {suggestion.fullAddress}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {treatments} treatments of {SURFACE_LABEL[surface].toLowerCase()}
          {petFriendly && ", pet safe"}
        </p>
        <p className="mt-1 text-3xl font-bold text-primary tabular-nums">
          ${total.toLocaleString()}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Paid once, up front, for the season.</p>
      </div>

      {!offer.canPay ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          Card payments are not switched on yet. Give us a call and we will book you in by hand.
        </p>
      ) : (
        <button
          type="button"
          disabled={!ready || pending}
          onClick={submit}
          className={cn(
            "h-14 rounded-xl bg-primary text-base font-semibold text-primary-foreground",
            (!ready || pending) && "opacity-50"
          )}
        >
          {pending ? "Opening the card form…" : `Pay $${total.toLocaleString()} and book it`}
        </button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-center text-xs text-muted-foreground">
        We will reach out as the weather gets closer to confirm everything. Nothing else to do
        after this.
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="h-11 rounded-lg border border-border bg-background px-3 text-base"
      />
    </div>
  );
}
