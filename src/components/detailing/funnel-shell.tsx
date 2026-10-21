import Link from "next/link";
import { Phone } from "lucide-react";

import { business, vehicleOrder, vehiclePhotos } from "@/lib/detailing";

const STEPS = ["Your info", "Your plan", "Done"];

export function FunnelShell({ step, children }: { step: 1 | 2 | 3; children: React.ReactNode }) {
  return (
    <div className="bg-hex min-h-screen">
      <header className="border-b border-[#d4a843]/20 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/detailing" className="leading-none">
            <span className="text-silver block text-lg font-extrabold tracking-wide">APEX SHINE</span>
            <span className="text-gold block text-[10px] font-bold tracking-[0.5em]">MOBILE</span>
          </Link>
          <a
            href={business.phoneHref}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#f0c75e] hover:text-white"
          >
            <Phone className="size-4" /> {business.phoneDisplay}
          </a>
        </div>
      </header>

      <ol className="mx-auto flex max-w-md items-center justify-center gap-2 px-4 pt-8 text-[11px] font-semibold uppercase tracking-widest">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex size-6 items-center justify-center rounded-full border text-[11px] ${
                  active || done ? "bg-gold border-transparent text-black" : "border-white/25 text-white/40"
                }`}
              >
                {n}
              </span>
              <span className={active ? "text-white" : "text-white/40"}>{label}</span>
              {n < STEPS.length && <span className="mx-1 h-px w-6 bg-white/20" />}
            </li>
          );
        })}
      </ol>

      <main className="mx-auto max-w-5xl px-4 pb-12 pt-8">{children}</main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-[10px] leading-relaxed text-white/30">
        Vehicle photos via Wikimedia Commons:{" "}
        {vehicleOrder
          .map((id) => vehiclePhotos[id].credit)
          .filter(Boolean)
          .join("; ")}
        ; others public domain.
      </footer>
    </div>
  );
}
