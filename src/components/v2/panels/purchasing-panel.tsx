import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadPurchasingPanel, untyped, type PoView } from "@/lib/data/purchasing";
import { PO_STATUS_LABEL, type PoStatus } from "@/lib/purchasing/takeoff";
import { PoActions, PurchasingSettingsForm, RaiseReordersButton, SourcingEditor } from "@/components/v2/panels/purchasing-controls";
import { OpenEntity } from "@/components/v2/panels/ops-open";

/**
 * Operations › Materials & equipment: purchasing.
 *
 * What needs a person first (orders to approve, orders with nowhere to go,
 * sends that failed, materials late for a job), then how purchasing is doing
 * against target, then every open order by status, what upcoming jobs need,
 * the shelf below its reorder points, and the switches.
 */

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

const STATUS_ORDER: PoStatus[] = ["draft", "sent", "confirmed", "partial"];

function Kpi({ label, value, target, tone }: { label: string; value: string; target: string; tone: "good" | "warn" | "bad" | "none" }) {
  const toneClass =
    tone === "good"
      ? "border-green-300 dark:border-green-800"
      : tone === "warn"
        ? "border-yellow-300 dark:border-yellow-800"
        : tone === "bad"
          ? "border-red-300 dark:border-red-800"
          : "";
  return (
    <div className={`rounded-xl border bg-card p-4 ${toneClass}`}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl">{value}</div>
      <div className="text-xs text-muted-foreground">Target {target}</div>
    </div>
  );
}

function OrderCard({ order, suppliers }: { order: PoView; suppliers: { id: string; name: string; email: string | null }[] }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <OpenEntity kind="ops.po" id={order.id} className="font-semibold">
          PO {order.poNumber} · {order.supplierName ?? "No supplier yet"}
        </OpenEntity>
        <div className="text-sm text-muted-foreground">
          {money(order.subtotalCents)}
          {!order.fullyPriced && " + unpriced"}
        </div>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {order.source === "reorder" ? "Reorder for stock" : order.jobId ? <OpenEntity kind="ops.job" id={order.jobId}>{order.jobName ?? "Job"}</OpenEntity> : "By hand"}
        {" · "}
        {order.fulfilment === "pickup" ? "Pickup" : "Delivery"}
        {order.neededBy && ` · needed by ${order.neededBy}`}
        {order.autoApproved && " · auto-approved"}
        {order.approvedAt && !order.autoApproved && order.status === "draft" && " · approved"}
      </div>
      <ul className="mt-2 grid gap-1 text-sm">
        {order.lines.map((l) => (
          <li key={l.id}>
            {qty(l.orderQuantity ?? l.quantity)} {l.orderUnit ?? l.unit} <OpenEntity kind="ops.material" id={l.materialId}>{l.name}</OpenEntity>
            {l.received > 0 && <span className="text-muted-foreground"> · {qty(l.received)} of {qty(l.quantity)} {l.unit} in</span>}
            {l.unitCostCents == null && <span className="text-orange-700 dark:text-orange-300"> · no price</span>}
          </li>
        ))}
      </ul>
      {order.notes && <p className="mt-2 text-sm text-muted-foreground">{order.notes}</p>}
      {order.sendError && <p className="mt-2 text-sm text-red-700 dark:text-red-300">Last send failed: {order.sendError}</p>}
      <PoActions order={order} suppliers={suppliers} />
    </li>
  );
}

export async function PurchasingPanel() {
  const organizationId = await getCurrentOrganizationId();
  const sb = untyped(await createClient());
  const data = await loadPurchasingPanel(sb, organizationId);

  if (!data.settings.ready) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-bold">Purchasing</h2>
        <p className="mt-1 text-sm text-muted-foreground">Purchase orders aren&apos;t set up yet. The database change for them (migration 0360) hasn&apos;t been applied.</p>
      </section>
    );
  }

  const open = data.orders.filter((o) => STATUS_ORDER.includes(o.status));
  const toApprove = open.filter((o) => o.status === "draft" && !o.approvedAt);
  const failed = open.filter((o) => o.sendError);
  const lateNeeds = data.upcoming.filter((u) => u.late);
  const needsYou = [
    ...data.openExceptions.map((e) => ({ key: `x-${e.id}`, text: `${e.jobName}: ${e.summary}`, detail: e.detail, open: { kind: "ops.exception", id: e.id } })),
    ...toApprove.map((o) => ({
      key: `a-${o.id}`,
      text: o.supplierId ? `PO ${o.poNumber} to ${o.supplierName} needs approving (${money(o.subtotalCents)}${o.fullyPriced ? "" : ", some lines unpriced"})` : `PO ${o.poNumber} has no supplier`,
      detail: o.jobName ? `For ${o.jobName}${o.neededBy ? `, needed by ${o.neededBy}` : ""}` : null,
      open: { kind: "ops.po", id: o.id },
    })),
    ...failed.map((o) => ({ key: `f-${o.id}`, text: `PO ${o.poNumber} didn't send`, detail: o.sendError, open: { kind: "ops.po", id: o.id } })),
  ];

  const onTimePct = data.onTime.started ? Math.round((data.onTime.inHand / data.onTime.started) * 100) : null;
  const unsentApproved = open.filter((o) => o.status === "draft" && o.approvedAt).length;
  const lowWithoutOrder = data.reorders.filter((r) => r.onOrder === 0 && !r.hasDraft).length;

  return (
    <section className="grid gap-4" aria-labelledby="purchasing-title">
      <h2 id="purchasing-title" className="text-lg font-bold">
        Purchasing &amp; deliveries
      </h2>

      {/* Needs you */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Needs you</h3>
        {needsYou.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing. Orders are moving on their own.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {needsYou.map((n) => (
              <li key={n.key} className="rounded-lg bg-orange-50 px-3 py-2 text-sm dark:bg-orange-950/40">
                <OpenEntity kind={n.open.kind} id={n.open.id} className="font-medium">
                  {n.text}
                </OpenEntity>
                {n.detail && <span className="block text-muted-foreground">{n.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Jobs with materials in hand on time (30 days)"
          value={onTimePct == null ? "—" : `${onTimePct}%`}
          target="95%"
          tone={onTimePct == null ? "none" : onTimePct >= 95 ? "good" : onTimePct >= 80 ? "warn" : "bad"}
        />
        <Kpi label="Jobs late on materials now" value={String(lateNeeds.length)} target="0" tone={lateNeeds.length ? "bad" : "good"} />
        <Kpi label="Orders waiting on a person" value={String(toApprove.length + unsentApproved)} target="0" tone={toApprove.length + unsentApproved > 3 ? "warn" : "good"} />
        <Kpi label="Below reorder, nothing ordered" value={String(lowWithoutOrder)} target="0" tone={lowWithoutOrder ? "warn" : "good"} />
      </div>

      {/* Orders by status */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Open orders</h3>
        {open.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No open purchase orders.</p>
        ) : (
          <div className="mt-2 grid gap-4">
            {STATUS_ORDER.map((status) => {
              const list = open.filter((o) => o.status === status);
              if (list.length === 0) return null;
              return (
                <div key={status}>
                  <h4 className="text-sm font-semibold text-muted-foreground">
                    {PO_STATUS_LABEL[status]} · {list.length}
                  </h4>
                  <ul className="mt-2 grid gap-2">
                    {list.map((o) => (
                      <OrderCard key={o.id} order={o} suppliers={data.suppliers} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        {data.orders.some((o) => !STATUS_ORDER.includes(o.status)) && (
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground">Closed in the last 60 days</summary>
            <ul className="grid gap-1 text-sm">
              {data.orders
                .filter((o) => !STATUS_ORDER.includes(o.status))
                .map((o) => (
                  <li key={o.id}>
                    <OpenEntity kind="ops.po" id={o.id}>
                      PO {o.poNumber} · {o.supplierName ?? "no supplier"} · {PO_STATUS_LABEL[o.status]} · {money(o.subtotalCents)}
                    </OpenEntity>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>

      {/* Upcoming needs */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Upcoming needs</h3>
        {data.upcoming.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No jobs waiting on materials.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {data.upcoming.map((u) => (
              <li key={u.jobId} className={`rounded-lg p-3 text-sm ${u.late ? "bg-red-50 dark:bg-red-950/40" : "bg-muted"}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <OpenEntity kind="ops.job" id={u.jobId} className="font-medium">
                    {u.jobName}
                  </OpenEntity>
                  <span className="text-muted-foreground">
                    {u.firstWorkDay ? `Starts ${u.firstWorkDay}` : "Not scheduled"}
                    {u.neededBy && ` · in hand by ${u.neededBy}`}
                  </span>
                </div>
                <ul className="mt-1 grid gap-0.5">
                  {u.lines.map((l, i) => (
                    <li key={i}>
                      {l.name}: {l.needed == null ? "how much?" : `${qty(l.needed)} ${l.unit}`}
                      {l.fromStock > 0 && ` · ${qty(l.fromStock)} from stock`}
                      {l.toOrder > 0 && ` · ${qty(l.toOrder)} to order`}
                      {l.note && <span className="text-muted-foreground"> · {l.note}</span>}
                    </li>
                  ))}
                </ul>
                {u.orders.length > 0 && (
                  <div className="mt-1 text-muted-foreground">{u.orders.map((o) => `PO ${o.poNumber}: ${PO_STATUS_LABEL[o.status]}`).join(" · ")}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Reorders */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-semibold">Below reorder point · {data.reorders.length}</h3>
          <RaiseReordersButton count={lowWithoutOrder} />
        </div>
        {data.reorders.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Everything is above its reorder point.</p>
        ) : (
          <ul className="mt-2 grid gap-1 text-sm">
            {data.reorders.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted px-3 py-2">
                <OpenEntity kind="ops.material" id={r.id} className="font-medium">
                  {r.name}
                </OpenEntity>
                <span className="text-muted-foreground">
                  {qty(r.onHand)} on hand · reorder at {qty(r.threshold)} {r.unit}
                  {r.onOrder > 0 ? ` · ${qty(r.onOrder)} on order` : r.hasDraft ? " · draft order waiting" : r.suggested ? ` · order ${qty(r.suggested)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Open a material to set its reorder point or count, or a supplier to set where its orders are emailed. Which product is preferred is under &ldquo;Where things come from&rdquo;.
        </p>
      </div>

      {/* Sourcing */}
      <details className="rounded-xl border bg-card p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Where things come from</summary>
        <SourcingEditor suppliers={data.suppliers} sourcing={data.sourcing} />
      </details>

      {/* Automation */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Automation</h3>
        <PurchasingSettingsForm settings={data.settings} />
      </div>
    </section>
  );
}
