"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import { Check, Loader2 } from "lucide-react";

import { requestMembership } from "@/lib/actions/detailing-lead-actions";
import { addOns, firstTimeDiscount, membershipPrices, vehicleOrder, vehiclePhotos, type VehicleSize } from "@/lib/detailing";

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
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const monthly = membershipPrices[size].price;
  const addOnTotal = addOns.filter((a) => picked.includes(a.id)).reduce((sum, a) => sum + a.price, 0);
  const firstVisit = monthly === null ? null : monthly - firstTimeDiscount + addOnTotal;

  return (
    <form action={requestMembership} className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <input type="hidden" name="lead" value={leadId} />

      <div className="grid gap-10">
        {/* They already picked this on step 1, so show it as a summary. The full
            grid only opens if they tap Change. */}
        {changing ? (
          <fieldset>
            <legend className="mb-4 text-lg font-bold uppercase tracking-wide">What we&apos;re detailing</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {vehicleOrder.map((id) => (
                <label
                  key={id}
                  className={`cursor-pointer overflow-hidden rounded-xl border-2 transition ${
                    size === id ? "border-[#d4a843] bg-[#d4a843]/10" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="vehicle_size"
                    value={id}
                    checked={size === id}
                    onChange={() => {
                      setSize(id);
                      setChanging(false);
                    }}
                    className="sr-only"
                  />
                  <span className="relative block aspect-[16/10]">
                    <Image src={vehiclePhotos[id].src} alt="" fill sizes="(max-width: 640px) 50vw, 240px" className="object-cover" />
                  </span>
                  <span className="block p-3 font-bold">{membershipPrices[id].label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="flex items-center gap-4 overflow-hidden rounded-xl border-2 border-[#d4a843] bg-[#d4a843]/10 pr-4">
            <input type="hidden" name="vehicle_size" value={size} />
            <span className="relative block aspect-[4/3] w-28 shrink-0 sm:w-36">
              <Image src={vehiclePhotos[size].src} alt="" fill sizes="144px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1 py-3">
              <span className="block text-xs uppercase tracking-widest text-white/50">Detailing your</span>
              <span className="block text-lg font-bold">{membershipPrices[size].label}</span>
              {monthly === null ? (
                <span className="text-gold block font-bold">Custom quote</span>
              ) : (
                <span className="font-display text-gold block text-2xl font-bold">
                  ${monthly}
                  <span className="ml-1 text-sm font-semibold text-white/50">/mo</span>
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="shrink-0 text-sm font-semibold text-[#f0c75e] underline-offset-4 hover:underline"
            >
              Change
            </button>
          </div>
        )}

        <fieldset>
          <legend className="mb-1 text-lg font-bold uppercase tracking-wide">Add-ons (optional)</legend>
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
