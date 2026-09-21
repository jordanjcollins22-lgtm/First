import Link from "next/link";
import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getRouteOrder } from "@/lib/data/route-approval";
import { routeName } from "@/lib/route-approval";
import { bundlesFor, piecesFor } from "@/lib/eddm-mailing";
import { PrintButton } from "@/components/eddm/print-button";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { dateShort } from "@/lib/time-zone";

/**
 * The order for one route: everything to print, walk and mail, on one page.
 *
 * The USPS package prints from its own page; this is the sheet that says
 * what was decided and where the rest is: how many mailers, when they drop
 * and where, how many hangers and sheets, who walks them and on what day.
 */
export const dynamic = "force-dynamic";

export default async function RouteOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile || (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin"))) notFound();
  const { orderId } = await params;
  const order = await getRouteOrder(orderId);
  if (!order) notFound();

  const dollars = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mailing = order.mailing;
  const bundles = mailing ? mailing.routes.reduce((sum, r) => sum + bundlesFor(piecesFor(r, mailing.audience)).length, 0) : 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 print:max-w-none print:px-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route order</p>
          <h1 className="text-2xl font-bold">{routeName(order.route)}</h1>
          <p className="text-sm text-muted-foreground">
            {order.submittedAt ? `Submitted ${dateShort(order.submittedAt)}` : "Not submitted yet"}
            {order.anchors.length > 0 ? ` · around ${order.anchors.map((e) => e.customerName ?? e.address).join(", ")}` : ""}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href="/my-day" className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm font-medium">
            Back to My Day
          </Link>
          <PrintButton />
        </div>
      </header>

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-base font-semibold">1. Mail: USPS route {order.route.routeId}, ZIP {order.route.zip}</h2>
        {mailing ? (
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <dt className="text-muted-foreground">Mail on</dt>
            <dd className="font-medium">{order.mailOn ? dateShort(`${order.mailOn}T12:00:00Z`) : "not set"}</dd>
            <dt className="text-muted-foreground">Pieces</dt>
            <dd className="font-medium">{mailing.pieces.toLocaleString()} residential</dd>
            <dt className="text-muted-foreground">Bundles</dt>
            <dd className="font-medium">{bundles} of up to 100, one facing slip each</dd>
            <dt className="text-muted-foreground">Drop at</dt>
            <dd className="font-medium">{mailing.dropFacilities.join(", ") || order.route.facility || "see USPS package"}</dd>
            <dt className="text-muted-foreground">Postage</dt>
            <dd className="font-medium">{mailing.postagePerPiece == null ? "rate not entered" : dollars(mailing.postageCents)}</dd>
            <dt className="text-muted-foreground">Printing</dt>
            <dd className="font-medium">{dollars(mailing.printCostCents)}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No mailing on this order.</p>
        )}
        {mailing && (
          <p className="mt-2 text-sm print:hidden">
            <Link href={`/eddm/mailings/${mailing.id}/order`} className="underline">
              Open the USPS order package (route list, facing slips)
            </Link>
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-base font-semibold">2. Door hangers</h2>
        {order.round ? (
          <>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Walk on</dt>
              <dd className="font-medium">{order.walkOn ? dateShort(`${order.walkOn}T12:00:00Z`) : "not set"}</dd>
              <dt className="text-muted-foreground">Doors</dt>
              <dd className="font-medium">{order.round.doors.length}</dd>
              <dt className="text-muted-foreground">Print</dt>
              <dd className="font-medium">{order.sheets ? `${order.sheets} sheets` : "set up the door hanger design first"}</dd>
              <dt className="text-muted-foreground">Walked by</dt>
              <dd className="font-medium">{order.round.assignedToName ?? "not assigned yet"}</dd>
            </dl>
            <p className="mt-2 text-sm print:hidden">
              <Link href={`/routes/${order.round.id}`} className="underline">
                Open the walking route
              </Link>
              {" · "}
              <Link href="/admin/door-hangers" className="underline">
                Print the hangers
              </Link>
            </p>
            <ol className="mt-3 columns-2 gap-6 text-xs text-muted-foreground sm:columns-3">
              {order.round.doors.map((door, i) => (
                <li key={`${door.address}-${i}`} className="break-inside-avoid">
                  {i + 1}. {door.address}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No door hanger round on this order.</p>
        )}
      </section>
    </div>
  );
}
