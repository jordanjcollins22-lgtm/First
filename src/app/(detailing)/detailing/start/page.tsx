import type { Metadata } from "next";
import { Car, MapPin, ShieldCheck } from "lucide-react";

import { FunnelShell } from "@/components/detailing/funnel-shell";
import { LeadForm } from "@/components/detailing/lead-form";
import { firstTimeDiscount } from "@/lib/detailing";

export const metadata: Metadata = {
  title: "Book Your Detail | Apex Shine Mobile",
};

export default function FunnelStartPage() {
  return (
    <FunnelShell step={1}>
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_540px]">
        <div className="text-center lg:pt-6 lg:text-left">
          <span className="bg-gold inline-block rounded-full px-4 py-1 text-xs font-bold uppercase tracking-widest text-black">
            ${firstTimeDiscount} off for first timers
          </span>
          <h1 className="font-display mt-5 text-5xl font-bold uppercase leading-[0.95] sm:text-6xl lg:text-5xl xl:text-6xl">
            <span className="text-silver block">Mobile detailing</span>
            <span className="text-gold block">that comes to you.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-lg text-white/70 lg:mx-0">
            Tell us who you are and where your car will be. Next, you&apos;ll see your monthly plan and price.
          </p>
          <ul className="mx-auto mt-8 grid max-w-md gap-4 text-left lg:mx-0">
            {[
              { icon: MapPin, text: "We come to your home or work. No drop-off, no waiting room." },
              { icon: Car, text: "Interior and exterior done right, every month." },
              { icon: ShieldCheck, text: "Locked-in pricing and priority scheduling for members." },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-white/80">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#d4a843] text-[#f0c75e]">
                  <Icon className="size-4" />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-[#d4a843]/40 bg-black/70 p-6 shadow-[0_0_80px_-30px_rgba(212,168,67,0.6)] sm:p-8">
          <h2 className="mb-1 text-xl font-bold uppercase tracking-wide">Get started</h2>
          <p className="mb-6 text-sm text-white/55">Takes about 30 seconds.</p>
          <LeadForm />
        </div>
      </div>
    </FunnelShell>
  );
}
