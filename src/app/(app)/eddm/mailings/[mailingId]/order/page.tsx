import { notFound } from "next/navigation";

import { requireAnyTab } from "@/lib/data/access";
import { getEddmMailing } from "@/lib/data/eddm";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { bundlesFor, EDDM_MAX_PER_ZIP_PER_DAY, EDDM_MIN_PER_ZIP, piecesFor } from "@/lib/eddm-mailing";
import { PrintButton } from "@/components/eddm/print-button";

/**
 * The order package for one EDDM mailing: everything USPS asks for, on paper.
 *
 * The route list with the IDs the EDDM order form wants, the piece count and
 * the postage, the post office the bundles go to, the checks that would
 * otherwise fail at the counter, and one facing slip for every bundle,
 * carrying what PS Form 3587 carries. What is left to do on USPS's site is
 * pay. Printed as-is: the slips break onto their own pages.
 */
export default async function EddmOrderPage({ params }: { params: Promise<{ mailingId: string }> }) {
  await requireAnyTab(["project-data"], "/attractors");
  const { mailingId } = await params;
  const [mailing, organization] = await Promise.all([getEddmMailing(mailingId), getCurrentOrganization()]);
  if (!mailing) notFound();

  const dollars = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const perZip = new Map<string, number>();
  for (const route of mailing.routes) perZip.set(route.zip, (perZip.get(route.zip) ?? 0) + piecesFor(route, mailing.audience));
  const problems = [...perZip.entries()]
    .map(([zip, pieces]) =>
      pieces < EDDM_MIN_PER_ZIP
        ? `${zip}: ${pieces} pieces is under the ${EDDM_MIN_PER_ZIP}-piece minimum for a ZIP.`
        : pieces > EDDM_MAX_PER_ZIP_PER_DAY
          ? `${zip}: ${pieces.toLocaleString()} pieces is over the ${EDDM_MAX_PER_ZIP_PER_DAY.toLocaleString()} allowed per day; split across days.`
          : null
    )
    .filter((p): p is string => Boolean(p));
  const today = new Date().toLocaleDateString();
  const totalBundles = mailing.routes.reduce((sum, r) => sum + bundlesFor(piecesFor(r, mailing.audience)).length, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
      <style>{`@media print { @page { margin: 12mm; } .slip { break-inside: avoid; } }`}</style>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{mailing.name}</h1>
          <p className="text-sm text-muted-foreground">
            EDDM Retail order package · {organization.name} · prepared {today}
          </p>
        </div>
        <PrintButton />
      </div>

      {problems.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">USPS would refuse this as it stands:</p>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Routes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3">ZIP</th>
              <th className="py-1 pr-3">Route</th>
              <th className="py-1 pr-3 text-right">Residential</th>
              <th className="py-1 pr-3 text-right">Business</th>
              <th className="py-1 pr-3 text-right">Pieces</th>
              <th className="py-1 pr-3 text-right">Bundles</th>
              <th className="py-1">Post office</th>
            </tr>
          </thead>
          <tbody>
            {mailing.routes.map((r) => {
              const pieces = piecesFor(r, mailing.audience);
              return (
                <tr key={`${r.zip}-${r.routeId}`} className="border-b">
                  <td className="py-1 pr-3 font-mono">{r.zip}</td>
                  <td className="py-1 pr-3 font-mono">{r.routeId}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{(r.residential ?? 0).toLocaleString()}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{(r.business ?? 0).toLocaleString()}</td>
                  <td className="py-1 pr-3 text-right font-semibold tabular-nums">{pieces.toLocaleString()}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{bundlesFor(pieces).length}</td>
                  <td className="py-1">{r.facility ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Totals</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
            <dt>Audience</dt>
            <dd className="text-right">{mailing.audience === "all" ? "Residential and business" : "Residential only"}</dd>
            <dt>Pieces</dt>
            <dd className="text-right font-semibold">{mailing.pieces.toLocaleString()}</dd>
            <dt>Bundles</dt>
            <dd className="text-right">{totalBundles}</dd>
            <dt>Postage</dt>
            <dd className="text-right">
              {mailing.postagePerPiece != null
                ? `${dollars(mailing.postageCents)} at $${mailing.postagePerPiece.toFixed(3)} each`
                : "rate not entered"}
            </dd>
            <dt>Printing (in-house)</dt>
            <dd className="text-right">{dollars(mailing.printCostCents)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">
              {mailing.postagePerPiece != null ? dollars(mailing.postageCents + mailing.printCostCents) : "—"}
            </dd>
          </dl>
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">At the post office</p>
          <p className="mt-1">
            Take the bundles to: <strong>{mailing.dropFacilities.join(", ") || "the post office serving these routes"}</strong>
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Pay postage at eddm.usps.com (EDDM Retail), choosing the routes listed above.</li>
            <li>Tie pieces into bundles of up to 100, facing the same way, one facing slip on top of each.</li>
            <li>Keep each route&apos;s bundles together; each ZIP is its own drop.</li>
            <li>Bring the USPS receipt with the bundles.</li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold print:break-before-page">Facing slips</h2>
        <p className="mb-3 text-xs text-muted-foreground print:hidden">
          One per bundle, with what PS Form 3587 carries. USPS also prints its own version at EDDM Online; either goes
          on top of the bundle.
        </p>
        <div className="grid grid-cols-2 gap-3 print:grid-cols-2">
          {mailing.routes.flatMap((r) =>
            bundlesFor(piecesFor(r, mailing.audience)).map((count, index, all) => (
              <div key={`${r.zip}-${r.routeId}-${index}`} className="slip rounded-lg border-2 border-black p-3 text-sm">
                <p className="text-center text-base font-bold tracking-wide">EDDM RETAIL</p>
                <p className="text-center text-[11px] uppercase text-muted-foreground">Every Door Direct Mail · Facing slip</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-xs text-muted-foreground">Post office</dt>
                  <dd className="font-semibold">{r.facility ?? "—"}</dd>
                  <dt className="text-xs text-muted-foreground">ZIP Code</dt>
                  <dd className="font-mono text-lg font-bold">{r.zip}</dd>
                  <dt className="text-xs text-muted-foreground">Route</dt>
                  <dd className="font-mono text-lg font-bold">{r.routeId}</dd>
                  <dt className="text-xs text-muted-foreground">Pieces in bundle</dt>
                  <dd className="font-semibold">{count}</dd>
                  <dt className="text-xs text-muted-foreground">Bundle</dt>
                  <dd>
                    {index + 1} of {all.length}
                  </dd>
                  <dt className="text-xs text-muted-foreground">Mailer</dt>
                  <dd>{organization.name}</dd>
                  <dt className="text-xs text-muted-foreground">Date</dt>
                  <dd>{today}</dd>
                </dl>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
