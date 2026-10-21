import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Phone } from "lucide-react";

import { FunnelShell } from "@/components/detailing/funnel-shell";
import { addOns, business, firstTimeDiscount, membershipPrices } from "@/lib/detailing";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "You're In | Apex Shine Mobile",
};

export default async function FunnelDonePage({ searchParams }: PageProps<"/detailing/start/done">) {
  const { lead } = await searchParams;
  const { data } =
    typeof lead === "string"
      ? await createAdminClient()
          .from("detailing_leads")
          .select("name, vehicle_size, monthly_price, add_ons, add_ons_total")
          .eq("id", lead)
          .maybeSingle()
      : { data: null };

  const pickedAddOns = addOns.filter((a) => data?.add_ons.includes(a.id));
  const firstVisit =
    data?.monthly_price != null ? data.monthly_price - firstTimeDiscount + (data.add_ons_total ?? 0) : null;

  return (
    <FunnelShell step={3}>
      <div className="mx-auto max-w-xl text-center">
        <CheckCircle2 className="mx-auto size-16 text-[#d4a843]" />
        <h1 className="font-display mt-5 text-5xl font-bold uppercase leading-[0.95]">
          <span className="text-silver">You&apos;re </span>
          <span className="text-gold">in{data ? `, ${data.name.split(/\s+/)[0]}` : ""}!</span>
        </h1>
        <p className="mt-4 text-lg text-white/70">
          We got your Complete Care request. We&apos;ll call or text you shortly to confirm and schedule your first visit.
        </p>

        {data?.vehicle_size && firstVisit != null && (
          <div className="mt-8 rounded-2xl border border-[#d4a843]/40 bg-black/70 p-6 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#d4a843]">Your plan</p>
            <p className="mt-1 text-lg font-bold">
              Complete Care · {membershipPrices[data.vehicle_size].label}
            </p>
            {pickedAddOns.length > 0 && (
              <p className="mt-2 text-sm text-white/65">Add-ons: {pickedAddOns.map((a) => a.name).join(", ")}</p>
            )}
            <p className="mt-4 text-sm text-white/65">
              First visit <span className="text-gold text-xl font-bold">${firstVisit}</span>, then ${data.monthly_price}/mo
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            href={business.phoneHref}
            className="bg-gold inline-flex h-12 items-center justify-center gap-2 rounded-md px-6 font-bold uppercase tracking-wider text-black transition hover:brightness-110"
          >
            <Phone className="size-4" /> Call {business.phoneDisplay}
          </a>
          <Link
            href="/detailing"
            className="inline-flex h-12 items-center justify-center rounded-md border border-[#d4a843] px-6 font-bold uppercase tracking-wider text-[#f0c75e] transition hover:bg-[#d4a843]/10"
          >
            Back to site
          </Link>
        </div>
      </div>
    </FunnelShell>
  );
}
