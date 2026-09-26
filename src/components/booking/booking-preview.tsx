"use client";

import { useState, type ComponentProps } from "react";

import { BookingWizard } from "@/components/booking/booking-wizard";

/**
 * The owner's preview of the booking card, with the "as somebody asking
 * about" chips. Switching service is done here, in the browser: it used to
 * reload the whole page from the server for every chip.
 */
export function BookingPreview({ serviceNames, ...wizard }: Omit<ComponentProps<typeof BookingWizard>, "preview" | "service"> & { serviceNames: string[] }) {
  const [as, setAs] = useState<string | null>(null);
  const chip = (on: boolean) => `rounded-full border px-2 py-0.5 ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`;
  return (
    <div>
      {serviceNames.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 px-4 text-xs">
          <span className="text-muted-foreground">As somebody asking about</span>
          <button type="button" onClick={() => setAs(null)} className={chip(!as)}>
            Anything
          </button>
          {serviceNames.slice(0, 8).map((name) => (
            <button key={name} type="button" onClick={() => setAs(name)} className={chip(as === name)}>
              {name}
            </button>
          ))}
        </div>
      )}
      <BookingWizard key={as ?? "any"} {...wizard} preview service={as} />
    </div>
  );
}
