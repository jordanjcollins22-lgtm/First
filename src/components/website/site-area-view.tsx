import { CheckCircle2, MapPin, Phone } from "lucide-react";

import { SiteReviews } from "@/components/website/site-view";
import { areaHref, defaultAreaIntro, websiteLinks, type SiteReview, type WebsiteArea, type WebsiteContent } from "@/lib/website";

/**
 * One town's page: what the business does there, in that town's name, for
 * people searching "lawn care Fallston" rather than the business's name.
 * Drawn from the same content as the home page, so a service renamed in the
 * editor is renamed on every town page too.
 */
export function SiteAreaView({
  content: c,
  area,
  orgSlug,
  reviews = [],
  newTab = false,
}: {
  content: WebsiteContent;
  area: WebsiteArea;
  orgSlug: string | null;
  reviews?: SiteReview[];
  newTab?: boolean;
}) {
  const links = websiteLinks(orgSlug);
  const target = newTab ? { target: "_blank", rel: "noreferrer" } : {};
  const tel = c.phone.replace(/[^\d+]/g, "");
  const intro = area.intro.trim() || defaultAreaIntro(area.town, c.businessName);
  const others = c.areas.filter((a) => a.town !== area.town);

  return (
    <div className="@container bg-white text-stone-900">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
        <a href={links.site} {...target} className="truncate text-lg font-extrabold text-[#2f6d3c]">
          {c.businessName}
        </a>
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

      <section className="bg-gradient-to-br from-[#2f6d3c] to-[#1f4a29] px-5 py-12 text-white @3xl:px-12 @3xl:py-20">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white/80">
          <MapPin className="h-4 w-4" /> {area.town}, Maryland
        </p>
        <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight @3xl:text-5xl">
          Lawn care &amp; landscaping in {area.town}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/85 @3xl:text-lg">{intro}</p>
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
          <h2 className="text-2xl font-extrabold">What we do in {area.town}</h2>
          <div className="mt-6 grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
            {c.services.map((s) => (
              <div key={s.name} className="rounded-xl border border-stone-200 p-4">
                <h3 className="font-bold">
                  {s.name} in {area.town}
                </h3>
                {s.blurb && <p className="mt-1 text-sm text-stone-600">{s.blurb}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {c.whyUs.length > 0 && (
        <section className="bg-stone-50 px-5 py-12 @3xl:px-12">
          <h2 className="text-2xl font-extrabold">Why {area.town} neighbors choose us</h2>
          <ul className="mt-5 grid gap-2.5 @lg:grid-cols-2">
            {c.whyUs.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2f6d3c]" /> <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.showReviews && reviews.length > 0 && <SiteReviews reviews={reviews} />}

      {others.length > 0 && (
        <section className="px-5 py-10 @3xl:px-12">
          <h2 className="text-lg font-extrabold">Also serving</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {others.map((a) => (
              <li key={a.town}>
                <a href={areaHref(orgSlug, a.town)} {...target} className="inline-flex min-h-10 items-center rounded-full border border-stone-300 px-4 text-sm font-semibold hover:border-[#2f6d3c] hover:text-[#2f6d3c]">
                  {a.town}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-[#2f6d3c] px-5 py-12 text-center text-white @3xl:px-12">
        <h2 className="text-2xl font-extrabold">Free evaluation in {area.town}</h2>
        <p className="mt-2 text-white/85">Pick a time that works and we&apos;ll come take a look. No cost, no pressure.</p>
        <a href={links.book} {...target} className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-bold text-[#2f6d3c] hover:bg-stone-100">
          {c.ctaLabel}
        </a>
      </section>

      <footer className="px-5 py-6 text-sm text-stone-600 @3xl:px-12">
        © {new Date().getFullYear()} {c.businessName} · {area.town}, MD
      </footer>
    </div>
  );
}
