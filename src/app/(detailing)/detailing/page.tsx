import Image from "next/image";
import {
  Armchair,
  CalendarCheck,
  Car,
  Check,
  Droplets,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  SprayCan,
} from "lucide-react";

import { QuoteForm } from "@/components/detailing/quote-form";
import { business, packages, services, steps, type Service } from "@/lib/detailing";

const serviceIcons: Record<Service["icon"], typeof Armchair> = {
  interior: Armchair,
  exterior: SprayCan,
  ceramic: Droplets,
  protection: ShieldCheck,
};

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function SectionHeading({ eyebrow, title, gold }: { eyebrow: string; title: string; gold: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.4em] text-[#d4a843]">{eyebrow}</p>
      <h2 className="font-display text-4xl font-bold uppercase leading-none sm:text-5xl">
        <span className="text-silver">{title} </span>
        <span className="text-gold">{gold}</span>
      </h2>
    </div>
  );
}

function GoldRule() {
  return <div className="mx-auto h-px w-full max-w-6xl bg-gradient-to-r from-transparent via-[#d4a843]/60 to-transparent" />;
}

export default function DetailingPage() {
  return (
    <>
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-[#d4a843]/20 bg-black/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <a href="#top" className="leading-none">
            <span className="text-silver block text-lg font-extrabold tracking-wide">APEX SHINE</span>
            <span className="text-gold block text-[10px] font-bold tracking-[0.5em]">MOBILE</span>
          </a>
          <nav className="hidden items-center gap-8 text-xs font-semibold uppercase tracking-[0.2em] text-white/75 md:flex">
            <a href="#services" className="hover:text-[#f0c75e]">Services</a>
            <a href="#packages" className="hover:text-[#f0c75e]">Packages</a>
            <a href="#how" className="hover:text-[#f0c75e]">How it works</a>
            <a href="/detailing/start" className="hover:text-[#f0c75e]">Book</a>
          </nav>
          <a
            href={business.phoneHref}
            className="bg-gold inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
          >
            <Phone className="size-4" />
            <span className="hidden sm:inline">{business.phoneDisplay}</span>
            <span className="sm:hidden">Call</span>
          </a>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="bg-hex relative overflow-hidden">
          <div className="pointer-events-none absolute -left-24 top-0 hidden h-full w-72 border-r border-[#d4a843]/40 [clip-path:polygon(0_0,100%_50%,0_100%)] lg:block" />
          <div className="pointer-events-none absolute -right-24 top-0 hidden h-full w-72 border-l border-[#d4a843]/40 [clip-path:polygon(100%_0,0_50%,100%_100%)] lg:block" />
          <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pb-20 pt-10 text-center sm:pt-14">
            <div className="relative aspect-[1254/540] w-full max-w-xl">
              <Image
                src="/detailing/logo.png"
                alt="Apex Shine Mobile, Premium Mobile Detailing"
                fill
                priority
                sizes="(max-width: 640px) 100vw, 576px"
                className="object-cover object-[50%_40%] mix-blend-lighten"
              />
            </div>
            <h1 className="font-display mt-6 text-5xl font-bold uppercase leading-[0.95] sm:text-7xl">
              <span className="text-silver block">Your car</span>
              <span className="text-gold block">deserves the best.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base text-white/70 sm:text-lg">
              Showroom-level interior and exterior detailing, ceramic coatings and paint protection,
              done right in your driveway.
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a
                href="/detailing/start"
                className="bg-gold inline-flex h-14 items-center justify-center gap-2 rounded-md px-8 font-bold uppercase tracking-wider text-black transition hover:brightness-110"
              >
                <CalendarCheck className="size-5" /> Book service
              </a>
              <a
                href="#packages"
                className="inline-flex h-14 items-center justify-center rounded-md border border-[#d4a843] px-8 font-bold uppercase tracking-wider text-[#f0c75e] transition hover:bg-[#d4a843]/10"
              >
                View pricing
              </a>
            </div>
          </div>

          {/* Trust strip */}
          <div className="relative border-y border-[#d4a843]/25 bg-black/60">
            <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-y-4 px-4 py-5 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 md:grid-cols-4">
              {[
                { icon: Car, label: "We come to you" },
                { icon: Sparkles, label: "Premium products" },
                { icon: CalendarCheck, label: "Fast & easy booking" },
                { icon: MapPin, label: "Locally owned" },
              ].map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center justify-center gap-2">
                  <Icon className="size-4 text-[#d4a843]" /> {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Services */}
        <section id="services" className="scroll-mt-20 px-4 py-24">
          <SectionHeading eyebrow="What we do" title="Detailing," gold="done right." />
          <div className="mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => {
              const Icon = serviceIcons[s.icon];
              return (
                <article
                  key={s.id}
                  className="group rounded-xl border border-[#d4a843]/25 bg-gradient-to-b from-white/[0.04] to-transparent p-6 transition hover:border-[#d4a843]/70"
                >
                  <div className="mb-5 inline-flex size-14 items-center justify-center rounded-xl border-2 border-[#d4a843] text-[#f0c75e]">
                    <Icon className="size-7" />
                  </div>
                  <h3 className="mb-2 text-lg font-bold uppercase tracking-wide">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-white/65">{s.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <GoldRule />

        {/* Packages */}
        <section id="packages" className="scroll-mt-20 px-4 py-24">
          <SectionHeading eyebrow="Packages" title="Clear &" gold="transparent." />
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-3">
            {packages.map((p) => (
              <article
                key={p.id}
                className={`relative flex flex-col rounded-2xl border p-8 ${
                  p.featured
                    ? "border-[#d4a843] bg-gradient-to-b from-[#d4a843]/15 to-black shadow-[0_0_60px_-20px_rgba(212,168,67,0.6)]"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                {p.featured && (
                  <span className="bg-gold absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-black">
                    Most popular
                  </span>
                )}
                <h3 className="text-xl font-bold uppercase tracking-wide">{p.name}</h3>
                <p className="mt-1 text-sm text-white/60">{p.blurb}</p>
                <p className="font-display mt-6 text-4xl font-bold">
                  {p.startingPrice === null ? (
                    <span className="text-gold">Get a quote</span>
                  ) : (
                    <>
                      <span className="mr-2 align-middle text-sm font-semibold uppercase tracking-widest text-white/50">From</span>
                      <span className="text-gold">${p.startingPrice}</span>
                    </>
                  )}
                </p>
                <ul className="my-8 grid gap-3 text-sm text-white/80">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#d4a843]" /> {f}
                    </li>
                  ))}
                </ul>
                <a
                  href="#book"
                  className={`mt-auto inline-flex h-12 items-center justify-center rounded-md font-bold uppercase tracking-wider transition ${
                    p.featured
                      ? "bg-gold text-black hover:brightness-110"
                      : "border border-[#d4a843] text-[#f0c75e] hover:bg-[#d4a843]/10"
                  }`}
                >
                  Book this
                </a>
              </article>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-white/50">
            Pricing depends on vehicle size and condition. Send a quick request and we&apos;ll get back to you with an exact price.
          </p>
        </section>

        {/* How it works */}
        <section id="how" className="bg-hex scroll-mt-20 border-y border-[#d4a843]/20 px-4 py-24">
          <SectionHeading eyebrow="How it works" title="Three steps to" gold="shine." />
          <ol className="mx-auto grid max-w-5xl gap-10 md:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="text-center">
                <div className="font-display text-gold mx-auto mb-4 flex size-16 items-center justify-center rounded-full border-2 border-[#d4a843] text-3xl font-bold">
                  {i + 1}
                </div>
                <h3 className="mb-2 text-lg font-bold uppercase tracking-wide">{step.title}</h3>
                <p className="text-sm text-white/65">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Results / Instagram */}
        <section className="px-4 py-24">
          <div className="mx-auto flex max-w-4xl flex-col items-center rounded-2xl border border-[#d4a843]/30 bg-gradient-to-br from-[#d4a843]/10 via-black to-black p-10 text-center sm:p-14">
            <InstagramIcon className="mb-5 size-12 text-[#f0c75e]" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.4em] text-[#d4a843]">See results</p>
            <h2 className="font-display text-4xl font-bold uppercase sm:text-5xl">
              <span className="text-silver">Before &amp; after </span>
              <span className="text-gold">gallery</span>
            </h2>
            <p className="mt-4 max-w-lg text-white/65">
              Follow along on Instagram for our latest transformations, ceramic coating jobs and interior resets.
            </p>
            <a
              href={business.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gold mt-8 inline-flex h-12 items-center gap-2 rounded-md px-7 font-bold text-black transition hover:brightness-110"
            >
              <InstagramIcon className="size-5" /> {business.instagramHandle}
            </a>
          </div>
        </section>

        <GoldRule />

        {/* Booking */}
        <section id="book" className="scroll-mt-20 px-4 py-24">
          <SectionHeading eyebrow="Book service" title="Request your" gold="detail." />
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.6fr]">
            <div className="flex flex-col gap-4">
              <a
                href={business.phoneHref}
                className="flex items-center gap-4 rounded-xl border border-[#d4a843]/30 p-5 transition hover:border-[#d4a843]"
              >
                <span className="flex size-12 items-center justify-center rounded-full border-2 border-[#d4a843] text-[#f0c75e]">
                  <Phone className="size-5" />
                </span>
                <span>
                  <span className="block text-xs uppercase tracking-widest text-white/50">Call or text</span>
                  <span className="block text-2xl font-bold">{business.phoneDisplay}</span>
                </span>
              </a>
              <a
                href={`mailto:${business.email}`}
                className="flex items-center gap-4 rounded-xl border border-[#d4a843]/30 p-5 transition hover:border-[#d4a843]"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-[#d4a843] text-[#f0c75e]">
                  <Mail className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-widest text-white/50">Email</span>
                  <span className="block truncate font-semibold">{business.email}</span>
                </span>
              </a>
              <a
                href={business.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 rounded-xl border border-[#d4a843]/30 p-5 transition hover:border-[#d4a843]"
              >
                <span className="flex size-12 items-center justify-center rounded-full border-2 border-[#d4a843] text-[#f0c75e]">
                  <InstagramIcon className="size-5" />
                </span>
                <span>
                  <span className="block text-xs uppercase tracking-widest text-white/50">Instagram</span>
                  <span className="block font-semibold">{business.instagramHandle}</span>
                </span>
              </a>
            </div>
            <div className="rounded-2xl border border-[#d4a843]/30 bg-white/[0.03] p-6 sm:p-8">
              <QuoteForm />
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#d4a843]/25 bg-black px-4 pb-28 pt-12 text-center md:pb-12">
        <p className="text-silver text-2xl font-extrabold tracking-wide">APEX SHINE</p>
        <p className="text-gold text-xs font-bold tracking-[0.6em]">MOBILE</p>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
          Interior <span className="text-[#d4a843]">•</span> Exterior <span className="text-[#d4a843]">•</span> Ceramic Coatings{" "}
          <span className="text-[#d4a843]">•</span> Paint Protection
        </p>
        <p className="text-gold mt-8 text-3xl italic [font-family:'Brush_Script_MT',cursive]">Thank You</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-white/60">For supporting local!</p>
        <p className="mt-8 text-xs text-white/40">
          © {new Date().getFullYear()} {business.name}. All rights reserved.
        </p>
      </footer>

      {/* Mobile sticky call/book bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-2 gap-2 border-t border-[#d4a843]/30 bg-black/95 p-3 backdrop-blur md:hidden">
        <a
          href={business.phoneHref}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[#d4a843] font-bold uppercase tracking-wider text-[#f0c75e]"
        >
          <Phone className="size-4" /> Call
        </a>
        <a
          href="/detailing/start"
          className="bg-gold inline-flex h-12 items-center justify-center gap-2 rounded-md font-bold uppercase tracking-wider text-black"
        >
          <CalendarCheck className="size-4" /> Book
        </a>
      </div>
    </>
  );
}
