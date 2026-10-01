import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { HandCoins, Smartphone, Snowflake } from "lucide-react";

import { StartAddress } from "./start-address";

/**
 * The front door: one offer, one box for the address, and straight into
 * booking with the address already in. Under it, the other three ways in:
 * earning as an affiliate, the winter salt list, and the client's own page.
 *
 * Prerendered: nothing on it varies by visitor. The address box reads the
 * link's ?ref= on the client, inside its own Suspense boundary, so a link
 * an affiliate shared still credits them when the booking is made.
 */

const BUSINESS_TEXT = "+14438191521";

const CARDS = [
  {
    icon: HandCoins,
    title: "Become an affiliate",
    body: "As an affiliate, make money and work on your schedule. Sign up in minutes.",
    cta: "Start earning",
    href: `sms:${BUSINESS_TEXT}?&body=${encodeURIComponent("Hi, I'd like to become a JS Landscaping affiliate.")}`,
  },
  {
    icon: Snowflake,
    title: "Get on the salt list",
    body: "Prepaid, pet-friendly ice melt for your walks and driveway. We come out when ice is forecast.",
    cta: "Salt my walks",
    href: "/salt",
  },
  {
    icon: Smartphone,
    title: "Your project, in one place",
    body: "Your visit, your proposal and your project's progress, all on your own page.",
    cta: "Open my page",
    href: "/my",
  },
] as const;

export default function StartPage() {
  return (
    <main className="flex flex-1 flex-col bg-white">
      <section className="relative overflow-hidden bg-[#2f6d3c] px-4 pb-16 pt-14 text-white sm:pb-20 sm:pt-20">
        {/* The work, at the edges, the way the food sits round a menu. */}
        <Photo src="/booking-work/front-bed-mulch-trim.jpg" className="-left-10 -top-10 h-72 w-72 rotate-[-8deg]" />
        <Photo src="/booking-work/bed-edging-mulch.jpg" className="-bottom-16 -left-20 h-64 w-64 rotate-[6deg]" />
        <Photo src="/booking-work/overgrowth-removal-mulch.jpg" className="-right-8 -top-12 h-72 w-72 rotate-[8deg]" />
        <Photo src="/booking-work/leaf-cleanup.jpg" className="-bottom-20 -right-16 h-64 w-64 rotate-[-6deg]" />

        <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
          {/* The mark beside the name, the way a brand sits over its offer. */}
          <p className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
            <Image src="/logo-mark.png" alt="" width={32} height={32} className="h-8 w-8" priority />
            JS Landscaping
          </p>
          <h1 className="mt-4 whitespace-nowrap text-[1.6rem] font-black uppercase leading-none tracking-tight sm:text-[2.6rem]">Free yard evaluation</h1>
          <p className="mt-1.5 text-[11px] font-semibold text-white/85">No obligation. Book in a minute.</p>
          <Suspense fallback={<div className="mt-6 h-14 w-full max-w-md rounded-full bg-white/90" />}>
            <StartAddress />
          </Suspense>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 sm:grid-cols-3">
        {CARDS.map(({ icon: Icon, title, body, cta, href }) => (
          <div key={title} className="flex flex-col items-center text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50">
              <Icon className="h-11 w-11 text-[#2f6d3c]" strokeWidth={1.6} />
            </span>
            <h2 className="mt-4 text-2xl font-extrabold leading-tight text-neutral-900">{title}</h2>
            <p className="mt-2 max-w-[17rem] text-sm text-neutral-700">{body}</p>
            <Link href={href} className="mt-3 text-sm font-bold text-[#2f6d3c] hover:underline">
              {cta} →
            </Link>
          </div>
        ))}
      </section>

      <footer className="mt-auto border-t border-neutral-200 py-4 text-center text-xs text-neutral-700">
        Free on-site evaluation, no obligation
        <Link href="/book" className="ml-4 font-semibold text-neutral-900 underline underline-offset-2">
          Book now
        </Link>
      </footer>
    </main>
  );
}

function Photo({ src, className }: { src: string; className: string }) {
  return (
    <div className={`pointer-events-none absolute hidden overflow-hidden rounded-[2rem] border-4 border-white/90 shadow-xl lg:block ${className}`} aria-hidden>
      <Image src={src} alt="" fill sizes="288px" className="object-cover" priority />
    </div>
  );
}
