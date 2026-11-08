import { CONDITIONS, type PricingVariables } from "@/lib/pricing-variables";
import type { PricingReport } from "@/lib/pricing-report";

/**
 * The one-page project report: the price and how it was reached, every
 * area's tasks and hours, the materials to order and everybody's time and
 * pay. Printed on one letter page; the office orders and schedules from it
 * once the job is signed.
 *
 * Plain markup with no state, so a server page and the live editor both
 * render it. Section ids (#pr-total, #pr-cost, #pr-areas, #pr-materials,
 * #pr-crew, #pr-variables) are what review checklists outline.
 */

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const usd2 = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (h: number) => (h >= 10 ? h.toFixed(0) : h.toFixed(1));
const qty = (n: number) => (Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const optionLabel = (key: string, value: string) => CONDITIONS.find((c) => c.key === key)?.options.find((o) => o.value === value)?.label.split(" (")[0] ?? value;

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1 ${strong ? "border-teal-700 bg-teal-50" : "border-stone-200"}`}>
      <div className="text-[10px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`${strong ? "text-xl" : "text-sm"} font-bold tabular-nums leading-tight`}>{value}</div>
      {sub && <div className="text-[10px] leading-tight text-stone-500">{sub}</div>}
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 border-b border-stone-300 pb-0.5 text-[11px] font-bold uppercase tracking-wide text-stone-700">{children}</h2>;
}

export function PricingReportView({ report: r, variables: v, date }: { report: PricingReport; variables: PricingVariables; date?: string }) {
  const src = (s: "app" | "manual") => (s === "app" ? "from the app" : "entered by hand");
  return (
    <article className="pricing-report mx-auto w-full max-w-[8.5in] bg-white p-4 text-[11px] leading-snug text-stone-900 print:p-0">
      <header className="mb-2 flex items-start justify-between gap-3 border-b-2 border-teal-700 pb-1.5">
        <div>
          <h1 className="text-lg font-extrabold leading-tight">{r.name}</h1>
          <p className="text-stone-600">{[r.client, r.address, date].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-stone-500">Total price</div>
          <div className="text-2xl font-extrabold tabular-nums leading-none text-teal-800">{usd(r.priceCents)}</div>
        </div>
      </header>

      <section id="pr-total" className="mb-2 grid grid-cols-4 gap-1.5 sm:grid-cols-8 print:grid-cols-8">
        <Stat label="Price P" value={usd(r.priceCents)} sub={`Ĉ × μ ${r.multiplier.toFixed(2)}`} strong />
        <Stat label="Direct DĈ" value={usd(r.dcCents)} sub="materials, disposal…" />
        <Stat label="Indirect IĈ" value={usd(r.icCents)} sub={`IR × ${hrs(r.pmMinutes / 60)} h`} />
        <Stat label="Cost Ĉ" value={usd(r.costCents)} sub="DĈ + IĈ" />
        <Stat label="Labour rev." value={usd(r.labourRevenueCents)} sub="P − DĈ" />
        <Stat label="Crew P4P" value={usd(r.p4p.payCents)} sub={`${pct(r.p4p.share)} of labour`} />
        <Stat label="Travel + logistics" value={`${hrs((r.time.clockMinutes - r.time.workClockMinutes) / 60)} h`} sub={`of ${r.time.billedHours} h on the clock`} />
        <Stat label="Gross profit" value={usd(r.grossProfitCents)} sub={`${pct(r.priceCents > 0 ? r.grossProfitCents / r.priceCents : 0)} · P − Ĉ`} />
      </section>

      <section id="pr-cost" className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <H>Direct cost DĈ</H>
          <table className="w-full">
            <tbody>
              {r.direct.map((d) => (
                <tr key={d.key} className={d.cents === 0 && !d.detail ? "text-stone-400" : ""}>
                  <td className="py-px">
                    {d.label}
                    {d.detail && <span className="text-stone-500"> · {d.detail}</span>}
                  </td>
                  <td className="py-px text-right tabular-nums">{usd(d.cents)}</td>
                </tr>
              ))}
              <tr className="border-t border-stone-300 font-bold">
                <td className="py-px">DĈ</td>
                <td className="py-px text-right tabular-nums">{usd(r.dcCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <H>Indirect and capacity</H>
          <table className="w-full">
            <tbody>
              <tr>
                <td className="py-px">IC₉₀ · {src(r.pool.ic90Source)}</td>
                <td className="py-px text-right tabular-nums">{usd(r.pool.ic90Cents)}</td>
              </tr>
              <tr>
                <td className="py-px">PM₉₀ · {src(r.pool.pm90Source)}</td>
                <td className="py-px text-right tabular-nums">{Math.round(r.pool.pm90Minutes).toLocaleString("en-US")} min</td>
              </tr>
              <tr>
                <td className="py-px">IR = IC₉₀ ÷ PM₉₀</td>
                <td className="py-px text-right tabular-nums">{usd2(r.irCents)}/min</td>
              </tr>
              <tr>
                <td className="py-px">PM̂ (elapsed, whole hours)</td>
                <td className="py-px text-right tabular-nums">{r.pmMinutes.toLocaleString("en-US")} min</td>
              </tr>
              <tr>
                <td className="py-px">IĈ = IR × PM̂</td>
                <td className="py-px text-right tabular-nums">{usd(r.icCents)}</td>
              </tr>
              <tr>
                <td className="py-px">
                  U = {qty(r.pool.bookedHours)} ÷ {qty(r.pool.availableHours)} h · {src(r.pool.bookedSource === "app" && r.pool.availableSource === "app" ? "app" : "manual")}
                </td>
                <td className="py-px text-right tabular-nums">{pct(r.utilization)}</td>
              </tr>
              <tr className="border-t border-stone-300 font-bold">
                <td className="py-px">μ(U) · implied margin {pct(r.impliedMargin)}</td>
                <td className="py-px text-right tabular-nums">{r.multiplier.toFixed(2)}×</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.25fr_1fr] print:grid-cols-[1.25fr_1fr]">
        <section id="pr-areas">
          <H>Areas · tasks and hours</H>
          {r.areas.map((a) => (
            <div key={a.id} className="mb-1.5 break-inside-avoid">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-bold">
                  {a.name}
                  <span className="font-normal text-stone-500">
                    {" "}
                    {[a.sf ? `${qty(a.sf)} SF` : null, a.lf ? `${qty(a.lf)} LF` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="tabular-nums text-stone-600">{hrs(a.labourHours)} labour h</span>
              </div>
              <div className="text-[10px] text-stone-500">
                {CONDITIONS.map((c) => `${c.label.split(" /")[0]}: ${optionLabel(c.key, a.conditions[c.key])}`).join(" · ")}
                {!a.confirmed && <span className="font-semibold text-amber-700"> · not confirmed</span>}
              </div>
              <table className="w-full">
                <tbody>
                  {a.tasks.map((t) => (
                    <tr key={t.key}>
                      <td className="py-px pr-1">{t.task}</td>
                      <td className="whitespace-nowrap py-px pr-1 text-right tabular-nums">{t.qty == null ? <span className="text-amber-700">qty needed</span> : `${qty(t.qty)} ${t.unit}`}</td>
                      <td className="whitespace-nowrap py-px pr-1 text-right tabular-nums text-stone-500">{t.factor !== 1 ? `×${t.factor.toFixed(2)}` : ""}</td>
                      <td className="whitespace-nowrap py-px text-right tabular-nums">{hrs(t.labourHours)} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-300 pt-0.5 font-bold">
            <span>Task labour, one person</span>
            <span className="tabular-nums">{hrs(r.taskLabourHours)} h</span>
          </div>
        </section>

        <div>
          <section id="pr-materials" className="mb-2">
            <H>Materials to order</H>
            <table className="w-full">
              <thead className="text-[10px] text-stone-500">
                <tr>
                  <th className="text-left font-medium">Item</th>
                  <th className="text-right font-medium">Amount</th>
                  <th className="text-left font-medium pl-1">Supplier</th>
                  <th className="text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {r.materials.map((m) => (
                  <tr key={m.key}>
                    <td className="py-px">{m.name}</td>
                    <td className="whitespace-nowrap py-px text-right tabular-nums">
                      {qty(m.order)} {m.unit}
                    </td>
                    <td className="py-px pl-1 text-stone-600">{m.supplier ?? "—"}</td>
                    <td className="whitespace-nowrap py-px text-right tabular-nums">{m.costCents == null ? <span className="font-semibold text-amber-700">price needed</span> : usd(m.costCents)}</td>
                  </tr>
                ))}
                {r.materials.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-px text-stone-500">
                      None
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section id="pr-crew">
            <H>Time by person</H>
            <p className="mb-0.5">
              Crew of {r.crew.size} ({r.crew.leads} lead{r.crew.leads === 1 ? "" : "s"}, {r.crew.techs} tech{r.crew.techs === 1 ? "" : "s"}) · {r.time.days} day{r.time.days === 1 ? "" : "s"} · {hrs(r.time.hoursPerDay)} h a day each ·{" "}
              {r.time.billedHours} h on the clock each
            </p>
            <table className="w-full">
              <thead className="text-[10px] text-stone-500">
                <tr>
                  <th className="text-left font-medium">Person</th>
                  <th className="text-right font-medium">Hours</th>
                  <th className="text-right font-medium">P4P pay</th>
                  <th className="text-right font-medium">$/h</th>
                  <th className="text-right font-medium">Floor from</th>
                </tr>
              </thead>
              <tbody>
                {r.p4p.people.map((p) => (
                  <tr key={p.label}>
                    <td className="py-px">{p.label}</td>
                    <td className="py-px text-right tabular-nums">{hrs(p.hours)}</td>
                    <td className="py-px text-right tabular-nums">
                      {usd(p.payCents)}
                      {p.floorApplies && <span className="text-amber-700"> (floor)</span>}
                    </td>
                    <td className="py-px text-right tabular-nums">{usd2(p.perHourCents)}</td>
                    <td className="py-px text-right tabular-nums">{p.floorFromHours == null ? "—" : `${hrs(p.floorFromHours)} h`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="mt-1 w-full whitespace-nowrap text-[10px] text-stone-600">
              <tbody>
                <tr>
                  <td>Tasks on the clock</td>
                  <td className="text-right tabular-nums">{hrs(r.time.workClockMinutes / 60)} h</td>
                  <td className="pl-2">Drive {r.time.driveMinutesEachWay} min each way{r.time.driveAssumed ? " (assumed)" : ""}</td>
                  <td className="text-right tabular-nums">{hrs(r.time.driveMinutes / 60)} h</td>
                </tr>
                <tr>
                  <td>Setup, breakdown, unloading</td>
                  <td className="text-right tabular-nums">{hrs((r.time.setupBreakdownMinutes + r.time.unloadingMinutes) / 60)} h</td>
                  <td className="pl-2">Pickup, dump runs</td>
                  <td className="text-right tabular-nums">{hrs((r.time.pickupMinutes + r.time.disposalMinutes) / 60)} h</td>
                </tr>
                <tr>
                  <td>Staging, walkthrough, inspection</td>
                  <td className="text-right tabular-nums">{hrs((r.time.stagingClockMinutes + r.time.walkthroughInspectionMinutes) / 60)} h</td>
                  <td className="pl-2">Rounded up to whole hours</td>
                  <td className="text-right tabular-nums">{hrs(r.time.billedHours - r.time.clockMinutes / 60)} h</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <section id="pr-variables" className="mt-2 border-t border-stone-300 pt-1 text-[10px] text-stone-600">
        <span className="font-bold uppercase tracking-wide text-stone-700">Variables </span>
        P4P {pct(v.pay.p4pShare)} of P − DĈ, lead weight {v.pay.leadWeight}× · Min wage {usd2(v.pay.minWageCents)}/h (Maryland, assumed) · Crew day {v.crew.hoursPerDay} h · Setup {v.logistics.setup} + breakdown{" "}
        {v.logistics.breakdown} min/day · Unload {v.logistics.smallUnload}/{v.logistics.largeUnload} min an item · Staging {v.logistics.stagingPerCy} min/CY · Walkthrough + inspection {v.logistics.walkthrough + v.logistics.inspection} min · Dump run{" "}
        {v.travel.disposalTripMinutes} min, {usd(v.travel.dumpFeeCents)} · Pickup {v.travel.pickupMinutes} min · μ {v.bands.map((b) => b.multiplier.toFixed(1)).join("/")} · Rates provisional
        {r.warnings.length > 0 && (
          <ul className="mt-0.5 list-disc pl-4 text-amber-800">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
