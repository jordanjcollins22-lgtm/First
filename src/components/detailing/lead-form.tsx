"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { createDetailingLead, type LeadFormState } from "@/lib/actions/detailing-lead-actions";
import { membershipPrices, vehicleOrder, vehiclePhotos } from "@/lib/detailing";

const fieldClass =
  "w-full rounded-md border border-white/15 bg-white/5 px-4 py-3.5 text-base text-white placeholder:text-white/40 focus:border-[#d4a843] focus:outline-none focus:ring-1 focus:ring-[#d4a843]";

export function LeadForm() {
  const [state, formAction, pending] = useActionState<LeadFormState, FormData>(createDetailingLead, {});
  const v = state.values;
  const [vehicle, setVehicle] = useState(v?.vehicle ?? "");

  return (
    <form action={formAction} className="grid gap-4">
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-white/80">What are we detailing?</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {vehicleOrder.map((id) => {
            const on = vehicle === id;
            return (
              <label
                key={id}
                className={`group relative block cursor-pointer overflow-hidden rounded-xl border-2 bg-black transition ${
                  on
                    ? "border-[#d4a843] shadow-[0_0_24px_-6px_rgba(212,168,67,0.8)]"
                    : "border-white/10 hover:border-white/40"
                }`}
              >
                <input
                  type="radio"
                  name="vehicle_size"
                  value={id}
                  required
                  checked={on}
                  onChange={() => setVehicle(id)}
                  className="sr-only"
                />
                <span className="relative block aspect-[4/3] overflow-hidden">
                  <Image
                    src={vehiclePhotos[id].src}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 50vw, 170px"
                    className={`object-cover transition duration-300 group-hover:scale-105 ${on ? "" : "brightness-90"}`}
                  />
                </span>
                <span
                  className={`block px-2 py-2 text-center text-xs font-bold uppercase tracking-wide ${
                    on ? "bg-gold text-black" : "text-white"
                  }`}
                >
                  {membershipPrices[id].label}
                </span>
                {on && (
                  <span className="bg-gold absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full text-black">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Full name
        <input name="name" required defaultValue={v?.name} autoComplete="name" placeholder="Jane Smith" className={fieldClass} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Phone number
        <input name="phone" type="tel" required defaultValue={v?.phone} autoComplete="tel" placeholder="(443) 555-0123" className={fieldClass} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Email
        <input name="email" type="email" required defaultValue={v?.email} autoComplete="email" placeholder="you@email.com" className={fieldClass} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Where will the car be?
        <input
          name="address"
          required
          defaultValue={v?.address}
          autoComplete="street-address"
          placeholder="Street address, city, zip"
          className={fieldClass}
        />
        <span className="text-xs font-normal text-white/45">Home, work, anywhere we can park next to it.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-gold mt-2 inline-flex h-14 items-center justify-center gap-2 rounded-md px-6 text-base font-bold uppercase tracking-wider text-black transition hover:brightness-110 disabled:opacity-70"
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : <>See my plan <ArrowRight className="size-5" /></>}
      </button>
      <p className="text-center text-xs text-white/45">No payment now. We&apos;ll only use this to schedule your detail.</p>
    </form>
  );
}
