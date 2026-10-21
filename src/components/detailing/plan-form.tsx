"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";

import { vehicleIcons } from "@/components/detailing/vehicle-icons";
import { requestMembership } from "@/lib/actions/detailing-lead-actions";
import { addOns, firstTimeDiscount, membershipPrices, vehicleOrder, type VehicleSize } from "@/lib/detailing";

function SubmitButton({ quote }: { quote: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-gold inline-flex h-14 w-full items-center justify-center gap-2 rounded-md px-6 text-base font-bold uppercase tracking-wider text-black transition hover:brightness-110 disabled:opacity-70"
    >
      {pending ? <Loader2 className="size-5 animate-spin" /> : quote ? "Request my quote" : "Start my membership"}
    </button>
  );
}

export function PlanForm({ leadId, initialVehicle }: { leadId: string; initialVehicle: VehicleSize }) {
  const [size, setSize] = useState<VehicleSize>(initialVehicle);
  const [picked, setPicked] = useState<string[]>([]);

  const monthly = membershipPrices[size].price;
  const addOnTotal = addOns.filter((a) => picked.includes(a.id)).reduce((sum, a) => sum + a.price, 0);
  const firstVisit = monthly === null ? null : monthly - firstTimeDiscount + addOnTotal;

  return (
    <form action={requestMembership} className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <input type="hidden" name="lead" value={leadId} />

      <div className="grid gap-10">
        <fieldset>
          <legend className="mb-4 text-lg font-bold uppercase tracking-wide">1. What we&apos;re detailing</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {vehicleOrder.map((id) => {
              const s = membershipPrices[id];
              const Icon = vehicleIcons[id];
              return (
                <label
                  key={id}
                  className={`cursor-pointer rounded-xl border p-4 transition ${
                    size === id ? "border-[#d4a843] bg-[#d4a843]/10" : "border-white/15 hover:border-white/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="vehicle_size"
                    value={id}
                    checked={size === id}
                    onChange={() => setSize(id)}
                    className="sr-only"
                  />
                  <Icon className={`mb-2 size-7 ${size === id ? "text-[#f0c75e]" : "text-white/60"}`} strokeWidth={1.5} />
                  <span className="block font-bold">{s.label}</span>
                  <span className="block text-xs text-white/50">{s.examples}</span>
                  {s.price === null ? (
                    <span className="text-gold mt-3 block text-lg font-bold">Custom quote</span>
                  ) : (
                    <span className="font-display text-gold mt-3 block text-3xl font-bold">
                      ${s.price}
                      <span className="ml-1 text-sm font-semibold text-white/50">/mo</span>
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-lg font-bold uppercase tracking-wide">2. Add-ons (optional)</legend>
          <p className="mb-4 text-sm text-white/55">Member pricing. Added to your first visit. You can add more anytime.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {addOns.map((a) => {
              const on = picked.includes(a.id);
              return (
                <label
                  key={a.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                    on ? "border-[#d4a843] bg-[#d4a843]/10" : "border-white/15 hover:border-white/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="add_ons"
                    value={a.id}
                    checked={on}
                    onChange={() => setPicked((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}
                    className="sr-only"
                  />
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border ${
                      on ? "bg-gold border-transparent text-black" : "border-white/30"
                    }`}
                  >
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className="flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{a.name}</span>
                      <span className="text-gold font-bold">+${a.price}</span>
                    </span>
                    <span className="block text-xs text-white/55">{a.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-[#d4a843] bg-gradient-to-b from-[#d4a843]/15 to-black p-6 shadow-[0_0_60px_-20px_rgba(212,168,67,0.6)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#d4a843]">Your plan</p>
          <p className="mt-1 text-xl font-bold uppercase">Complete Care</p>
          <dl className="mt-5 grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-white/65">{membershipPrices[size].label}</dt>
              <dd>{monthly === null ? "Quoted" : `$${monthly}/mo`}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/65">First-timer discount</dt>
              <dd className="text-[#f0c75e]">−${firstTimeDiscount}</dd>
            </div>
            {addOnTotal > 0 && (
              <div className="flex justify-between">
                <dt className="text-white/65">Add-ons ({picked.length})</dt>
                <dd>+${addOnTotal}</dd>
              </div>
            )}
            {firstVisit === null ? (
              <p className="mt-2 border-t border-white/15 pt-3 text-sm text-white/65">
                {membershipPrices[size].label} pricing depends on size and condition. We&apos;ll send your exact monthly
                price before your first visit.
              </p>
            ) : (
              <>
                <div className="mt-2 flex items-baseline justify-between border-t border-white/15 pt-3">
                  <dt className="font-semibold">First visit</dt>
                  <dd className="font-display text-gold text-3xl font-bold">${firstVisit}</dd>
                </div>
                <p className="text-right text-xs text-white/50">Then ${monthly}/mo</p>
              </>
            )}
          </dl>
          <div className="mt-6">
            <SubmitButton quote={monthly === null} />
          </div>
          <p className="mt-3 text-center text-xs text-white/50">
            No payment today. We&apos;ll call or text to confirm and schedule your first visit.
          </p>
        </div>
      </aside>
    </form>
  );
}
