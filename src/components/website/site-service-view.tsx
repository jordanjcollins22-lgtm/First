import { CheckCircle2, MapPin, Phone } from "lucide-react";

import { SiteReviews } from "@/components/website/site-view";
import { areaHref, serviceHref, serviceIntro, websiteLinks, type SiteReview, type WebsiteContent, type WebsiteService } from "@/lib/website";

/**
 * One service's page, county-wide (/site/services/<service>) or in one town
 * (/site/areas/<town>/<service>), for people searching "mulch Bel Air"
 * rather than the business's name. Drawn from the website editor's content,
 * so renaming a service there renames its pages too.
 */
export function SiteServiceView({
  content: c,
  service,
  town,
  orgSlug,
  reviews = [],
}: {
  content: WebsiteContent;
  service: WebsiteService;
  town: string | null;
  orgSlug: string | null;
  reviews?: SiteReview[];
}) {
  const links = websiteLinks(orgSlug);
  const tel = c.phone.replace(/[^\d+]/g, "");
  const where = town ?? "Harford County";
  const otherServices = c.services.filter((s) => s.name !== service.name);
  const otherTowns = c.areas.filter((a) => a.town !== town);

  const pill =
    "inline-flex min-h-10 items-center rounded-full border border-stone-300 px-4 text-sm font-semibold hover:border-[#2f6d3c] hover:text-[#2f6d3c]";

  return (
    <div className="@container bg-white text-stone-900">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
        <a href={links.site} className="truncate text-lg font-extrabold text-[#2f6d3c]">
          {c.businessName}
        </a>
        <div className="flex items-center gap-3">
          {c.phone && (
            <a href={`tel:${tel}`} className="hidden items-center gap-1.5 text-sm font-semibold @md:inline-flex">
              <Phone className="h-4 w-4" /> {c.phone}
            </a>
          )}
          <a href={links.book} className="rounded-lg bg-[#2f6d3c] px-3 py-2 text-sm font-bold text-white hover:bg-[#25582f]">
            Book now
          </a>
        </div>
      </header>

      <nav aria-label="Breadcrumb" className="px-5 pt-4 text-sm text-stone-600 @3xl:px-12">
        <a href={links.site} className="hover:underline">
          Home
        </a>
        {town && (
          <>
            {" › "}
            <a href={areaHref(orgSlug, town)} className="hover:underline">
              {town}
            </a>
          </>
        )}
        {" › "}
        <span>{service.name}</span>
      </nav>

      <section className="mt-3 bg-gradient-to-br from-[#2f6d3c] to-[#1f4a29] px-5 py-12 text-white @3xl:px-12 @3xl:py-20">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white/80">
          <MapPin className="h-4 w-4" /> {where}, Maryland
        </p>
        <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight @3xl:text-5xl">
          {service.name} in {where}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/85 @3xl:text-lg">{serviceIntro(service, town, c.businessName)}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={links.book} className="rounded-xl bg-white px-5 py-3 font-bold text-[#2f6d3c] shadow hover:bg-stone-100">
            {c.ctaLabel}
          </a>
          {c.phone && (
            <a href={`tel:${tel}`} className="rounded-xl border border-white/60 px-5 py-3 font-bold text-white hover:bg-white/10">
              Call {c.phone}
            </a>
          )}
        </div>
      </section>

      {c.whyUs.length > 0 && (
        <section className="bg-stone-50 px-5 py-12 @3xl:px-12">
          <h2 className="text-2xl font-extrabold">Why {where} neighbors choose us</h2>
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

      {otherServices.length > 0 && (
        <section className="px-5 pt-10 @3xl:px-12">
          <h2 className="text-lg font-extrabold">More we do in {where}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {otherServices.map((s) => (
              <li key={s.name}>
                <a href={serviceHref(orgSlug, s.name, town)} className={pill}>
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherTowns.length > 0 && (
        <section className="px-5 py-10 @3xl:px-12">
          <h2 className="text-lg font-extrabold">{service.name} near you</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {otherTowns.map((a) => (
              <li key={a.town}>
                <a href={serviceHref(orgSlug, service.name, a.town)} className={pill}>
                  {a.town}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-[#2f6d3c] px-5 py-12 text-center text-white @3xl:px-12">
        <h2 className="text-2xl font-extrabold">
          Free {service.name.toLowerCase()} evaluation in {where}
        </h2>
        <p className="mt-2 text-white/85">Pick a time that works and we&apos;ll come take a look. No cost, no pressure.</p>
        <a href={links.book} className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-bold text-[#2f6d3c] hover:bg-stone-100">
          {c.ctaLabel}
        </a>
      </section>

      <footer className="px-5 py-6 text-sm text-stone-600 @3xl:px-12">
        © {new Date().getFullYear()} {c.businessName} · {where}, MD
      </footer>
    </div>
  );
}
