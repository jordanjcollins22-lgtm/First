import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, Sparkles } from "lucide-react";

import { FunnelShell } from "@/components/detailing/funnel-shell";
import { PlanForm } from "@/components/detailing/plan-form";
import { membershipBenefits, membershipIncludes, type VehicleSize } from "@/lib/detailing";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Your Plan | Apex Shine Mobile",
};

function vehicleNoun(size: VehicleSize | null) {
  return size === "boat" ? "boat" : size === "rv" ? "RV" : size === "motorcycle" ? "bike" : "car";
}

export default async function FunnelPlanPage({ searchParams }: PageProps<"/detailing/start/plan">) {
  const { lead } = await searchParams;
  if (typeof lead !== "string") redirect("/detailing/start");

  const { data } = await createAdminClient().from("detailing_leads").select("id, name, vehicle_size").eq("id", lead).maybeSingle();
  if (!data) redirect("/detailing/start");

  const firstName = data.name.split(/\s+/)[0];

  return (
    <FunnelShell step={2}>
      {/* What it is */}
      <section className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[#d4a843]">Thanks, {firstName}</p>
        <h1 className="font-display mt-3 text-5xl font-bold uppercase leading-[0.95] sm:text-6xl">
          <span className="text-silver">Complete Care </span>
          <span className="text-gold">Membership</span>
        </h1>
        <p className="mt-5 text-lg text-white/70">
          Once a month, we come to you and fully detail your {vehicleNoun(data.vehicle_size)} inside and out: hand wash, wheels, glass, a full interior
          reset and a fresh coat of spray wax. No driving anywhere, no waiting. It just stays clean.
        </p>
      </section>

      {/* What we do */}
      <section className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
        {(
          [
            ["Interior, every visit", membershipIncludes.interior],
            ["Exterior, every visit", membershipIncludes.exterior],
          ] as const
        ).map(([title, items]) => (
          <div key={title} className="rounded-2xl border border-[#d4a843]/30 bg-black/60 p-6">
            <h2 className="mb-4 font-bold uppercase tracking-wide text-[#f0c75e]">{title}</h2>
            <ul className="grid gap-2.5 text-sm text-white/80">
              {items.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#d4a843]" /> {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <ul className="mx-auto mt-6 flex max-w-4xl flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-semibold uppercase tracking-[0.15em] text-white/70">
        {membershipBenefits.map((b) => (
          <li key={b} className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-[#d4a843]" /> {b}
          </li>
        ))}
      </ul>

      <div className="mx-auto my-14 h-px max-w-4xl bg-gradient-to-r from-transparent via-[#d4a843]/60 to-transparent" />

      <PlanForm leadId={data.id} initialVehicle={data.vehicle_size ?? "sedan"} />
    </FunnelShell>
  );
}
