import { notFound } from "next/navigation";

import { loadSeoStatus } from "@/lib/data/seo-status";
import { reviewScope } from "@/lib/data/review-scope";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { gbpWeeklyPlan, missingTownPages } from "@/lib/seo";
import { areaHref, serviceHref, websiteLinks } from "@/lib/website";

/**
 * Google SEO, for reviewing on a preview without signing in: the new service
 * and town pages, where review requests and the Business Profile stand, and
 * the weekly Business Profile plan. JS Landscaping's real numbers, read only;
 * town names and counts only, nothing about any one client.
 */
export const dynamic = "force-dynamic";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${ok ? "bg-green-600" : "bg-amber-500"}`}>
        {ok ? "✓" : "!"}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default async function ReviewGoogleSeoPage() {
  if (!reviewPagesEnabled()) notFound();
  const s = await loadSeoStatus(await reviewScope());
  const c = s.content;
  const links = websiteLinks(s.orgSlug);
  const missing = missingTownPages(s.towns);
  const plan = gbpWeeklyPlan({
    from: new Date(),
    towns: s.towns.filter((t) => t.hasPage).map((t) => t.town),
    services: c.services.map((x) => x.name),
    businessName: c.businessName,
    weeks: 4,
  });
  const pageCount = 1 + c.areas.length + c.services.length + c.areas.length * c.services.length;
  const a = "font-semibold text-[#2f6d3c] underline";

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-8 text-sm">
      <header>
        <h1 className="text-2xl font-extrabold">Google SEO</h1>
        <p className="mt-1 text-stone-600">
          {c.businessName}&apos;s real data, read only. Preview only: this page does not exist on the live site.
        </p>
      </header>

      <section id="seo-pages">
        <h2 className="text-lg font-bold">1. A page for every service in every town</h2>
        <p className="mt-1 text-stone-600">
          The website now has {pageCount} pages for Google to rank: home, {c.areas.length} town pages, {c.services.length} service pages, and{" "}
          {c.areas.length * c.services.length} service-in-town pages (like &quot;Mulch &amp; bed refresh in Bel Air&quot;). Each has its own title,
          description, canonical link and Service structured data, and all are in the <a className={a} href="/site/sitemap.xml">sitemap</a> that{" "}
          <a className={a} href="/site/robots.txt">robots.txt</a> points to.
        </p>
        <ul className="mt-3 space-y-1.5">
          <Check ok={s.websiteSaved}>
            {s.websiteSaved ? "The website has been saved in Marketing › Website." : "The website is still on its starting text: nothing has been saved in Marketing › Website yet, so the pages use the default services and towns."}
          </Check>
          <Check ok={Boolean(c.phone)}>{c.phone ? `Phone on every page: ${c.phone}.` : "No phone number on the website yet. Add it in Marketing › Website; Google matches it against the Business Profile."}</Check>
          <Check ok={missing.length === 0}>
            {missing.length === 0 ? "Every town with 2 or more jobs has its pages." : `Towns with 2+ jobs but no page yet: ${missing.join(", ")}. Add them in Marketing › Website › Towns.`}
          </Check>
        </ul>

        <h3 className="mt-5 font-bold">Towns, from the jobs</h3>
        <table className="mt-2 w-full max-w-md text-left">
          <thead className="text-stone-500">
            <tr>
              <th className="py-1 font-medium">Town</th>
              <th className="py-1 font-medium">Jobs</th>
              <th className="py-1 font-medium">Done</th>
              <th className="py-1 font-medium">Page</th>
            </tr>
          </thead>
          <tbody>
            {s.towns.map((t) => (
              <tr key={t.town} className="border-t border-stone-200">
                <td className="py-1">{t.town}</td>
                <td className="py-1">{t.jobs}</td>
                <td className="py-1">{t.done}</td>
                <td className="py-1">
                  {t.hasPage ? (
                    <a className={a} href={areaHref(s.orgSlug, t.town)}>
                      open
                    </a>
                  ) : (
                    <span className="text-stone-400">none</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mt-5 font-bold">The new pages</h3>
        <p className="mt-1">
          <a className={a} href={links.site}>
            Home
          </a>{" "}
          · Services:{" "}
          {c.services.map((x, i) => (
            <span key={x.name}>
              {i > 0 && " · "}
              <a className={a} href={serviceHref(s.orgSlug, x.name)}>
                {x.name}
              </a>
            </span>
          ))}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {c.areas.map((ar) => (
            <div key={ar.town} className="rounded-lg border border-stone-200 p-3">
              <a className="font-bold text-[#2f6d3c] underline" href={areaHref(s.orgSlug, ar.town)}>
                {ar.town}
              </a>
              <ul className="mt-1 space-y-0.5">
                {c.services.map((x) => (
                  <li key={x.name}>
                    <a className="text-stone-700 underline" href={serviceHref(s.orgSlug, x.name, ar.town)}>
                      {x.name} in {ar.town}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="seo-reviews">
        <h2 className="text-lg font-bold">2. Google reviews after every job</h2>
        <p className="mt-1 text-stone-600">
          Already built: when a client approves the before and afters or pays, they get a text (or email) with a one-tap 1 to 5 rating. Fives go
          straight to the Google review page; lower ratings come to you to fix. One reminder on day 3; nobody is asked twice in 12 months.
        </p>
        <ul className="mt-3 space-y-1.5">
          <Check ok={s.reviewLinkSet}>
            {s.reviewLinkSet ? "Google review link is set." : "No Google review link yet. Paste it in Automated messages › Google review request (copy it from the Business Profile's “Ask for reviews” button)."}
          </Check>
          <Check ok={s.reviewRequestsOn}>{s.reviewRequestsOn ? "Review requests are switched on." : "Review requests are switched off. Switch them on in the same place once the link is in."}</Check>
          <Check ok={s.reviewRequestsSent > 0}>
            {s.reviewRequestsSent} review requests sent so far, {s.ratedFive} rated five. {s.completedJobs} jobs finished.
          </Check>
        </ul>
      </section>

      <section id="seo-posts">
        <h2 className="text-lg font-bold">3. Google Business Profile, every week</h2>
        <ul className="mt-3 space-y-1.5">
          <Check ok={s.gbpConnected}>
            {s.gbpConnected ? "Business Profile is connected." : "Business Profile is not connected. Connect it in Settings › Integrations › Google Business Profile; until then nothing is posted, replied to or pulled."}
          </Check>
          <Check ok={s.gbpWeeklyPostOn}>
            {s.gbpWeeklyPostOn ? "Weekly before-and-after post is on." : "Weekly before-and-after post is off. Switch on “Weekly Google post from approved photos” in the marketing autopilot switches."}{" "}
            {s.postableBeforeAfters} approved before-and-afters are ready to post; {s.gbpPosts} posted so far. {s.googleReviews} Google reviews pulled.
          </Check>
        </ul>
        <h3 className="mt-5 font-bold">The next four weeks</h3>
        <ol className="mt-2 space-y-3">
          {plan.map((w) => (
            <li key={w.weekOf} className="rounded-lg border border-stone-200 p-3">
              <p className="text-xs font-semibold uppercase text-stone-500">
                Week of {w.weekOf} · {w.season}
              </p>
              <p className="mt-1 font-bold">{w.post.title}</p>
              <p className="text-stone-700">{w.post.body}</p>
            </li>
          ))}
        </ol>
        <h3 className="mt-5 font-bold">Every week, also</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {plan[0]?.checklist.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </section>
    </main>
  );
}
