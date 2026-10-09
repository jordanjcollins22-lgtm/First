import { CheckCircle2, Mail, MapPin, Phone } from "lucide-react";

import { websiteLinks, type WebsiteContent } from "@/lib/website";

/**
 * The business's website, drawn from its content.
 *
 * One component for the public page at /site and for the editor's live
 * preview, so what the owner sees while typing is what goes out. Laid out
 * with container queries rather than screen sizes, so the preview can be
 * shown at phone width inside a desktop window and still look like a phone.
 */
export function SiteView({
  content: c,
  orgSlug,
  newTab = false,
}: {
  content: WebsiteContent;
  orgSlug: string | null;
  /** In the editor's preview the buttons open the real pages in a new tab. */
  newTab?: boolean;
}) {
  const links = websiteLinks(orgSlug);
  const target = newTab ? { target: "_blank", rel: "noreferrer" } : {};
  const tel = c.phone.replace(/[^\d+]/g, "");

  return (
    <div className="@container bg-white text-stone-900">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
        <span className="truncate text-lg font-extrabold text-[#2f6d3c]">{c.businessName}</span>
        <div className="flex items-center gap-3">
          {c.phone && (
            <a href={`tel:${tel}`} className="hidden items-center gap-1.5 text-sm font-semibold @md:inline-flex">
              <Phone className="h-4 w-4" /> {c.phone}
            </a>
          )}
          <a href={links.book} {...target} className="rounded-lg bg-[#2f6d3c] px-3 py-2 text-sm font-bold text-white hover:bg-[#25582f]">
            Book now
          </a>
        </div>
      </header>

      <section className="bg-gradient-to-br from-[#2f6d3c] to-[#1f4a29] px-5 py-14 text-white @3xl:px-12 @3xl:py-24">
        <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight @3xl:text-5xl">{c.heroHeadline}</h1>
        {c.heroSub && <p className="mt-4 max-w-2xl text-base text-white/85 @3xl:text-lg">{c.heroSub}</p>}
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={links.book} {...target} className="rounded-xl bg-white px-5 py-3 font-bold text-[#2f6d3c] shadow hover:bg-stone-100">
            {c.ctaLabel}
          </a>
          {c.phone && (
            <a href={`tel:${tel}`} className="rounded-xl border border-white/60 px-5 py-3 font-bold text-white hover:bg-white/10">
              Call {c.phone}
            </a>
          )}
        </div>
      </section>

      {c.services.length > 0 && (
        <section className="px-5 py-12 @3xl:px-12">
          <h2 className="text-2xl font-extrabold">What we do</h2>
          <div className="mt-6 grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
            {c.services.map((s) => (
              <div key={s.name} className="rounded-xl border border-stone-200 p-4">
                <h3 className="font-bold">{s.name}</h3>
                {s.blurb && <p className="mt-1 text-sm text-stone-600">{s.blurb}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(c.showQuickMow || c.showSalt) && (
        <section className="grid gap-3 px-5 pb-12 @lg:grid-cols-2 @3xl:px-12">
          {c.showQuickMow && (
            <a href={links.mow} {...target} className="rounded-xl bg-[#eef6ef] p-5 hover:bg-[#e2efe4]">
              <span className="block text-lg font-extrabold text-[#2f6d3c]">Just need a mow?</span>
              <span className="text-sm text-stone-700">Type your address, see your price in seconds, and book your first cut. →</span>
            </a>
          )}
          {c.showSalt && (
            <a href={links.salt} {...target} className="rounded-xl bg-[#eef3f8] p-5 hover:bg-[#e1eaf3]">
              <span className="block text-lg font-extrabold text-[#24507a]">Pre-book ice melt</span>
              <span className="text-sm text-stone-700">Lock in salting for the winter before the first storm. →</span>
            </a>
          )}
        </section>
      )}

      {(c.whyUs.length > 0 || c.about) && (
        <section className="bg-stone-50 px-5 py-12 @3xl:px-12">
          <h2 className="text-2xl font-extrabold">Why neighbors choose us</h2>
          {c.about && <p className="mt-3 max-w-3xl text-stone-700">{c.about}</p>}
          {c.whyUs.length > 0 && (
            <ul className="mt-5 grid gap-2.5 @lg:grid-cols-2">
              {c.whyUs.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2f6d3c]" /> <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {c.serviceArea && (
        <section className="px-5 py-12 @3xl:px-12">
          <h2 className="flex items-center gap-2 text-2xl font-extrabold">
            <MapPin className="h-6 w-6 text-[#2f6d3c]" /> Where we work
          </h2>
          <p className="mt-3 max-w-3xl text-stone-700">{c.serviceArea}</p>
        </section>
      )}

      <section className="bg-[#2f6d3c] px-5 py-12 text-center text-white @3xl:px-12">
        <h2 className="text-2xl font-extrabold">Ready when you are.</h2>
        <p className="mt-2 text-white/85">Pick a time that works and we&apos;ll come take a look. No cost, no pressure.</p>
        <a href={links.book} {...target} className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-bold text-[#2f6d3c] hover:bg-stone-100">
          {c.ctaLabel}
        </a>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-stone-600 @3xl:px-12">
        <span>© {new Date().getFullYear()} {c.businessName}</span>
        <span className="flex flex-wrap gap-4">
          {c.phone && (
            <a href={`tel:${tel}`} className="inline-flex items-center gap-1 hover:text-stone-900">
              <Phone className="h-4 w-4" /> {c.phone}
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-stone-900">
              <Mail className="h-4 w-4" /> {c.email}
            </a>
          )}
        </span>
      </footer>
    </div>
  );
}
