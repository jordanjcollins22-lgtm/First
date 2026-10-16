import { cache } from "react";

import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadTerritoriesPanel } from "@/lib/data/sales-panels";
import { KpiTile, NeedsYouStrip, PanelSection, pct } from "@/components/v2/panels/sales/sales-ui";
import { TerritoriesEditor } from "@/components/v2/panels/sales/territories-editor";

/**
 * Sales › Evaluations: evaluator territories.
 *
 * Optional zip codes or drawn areas per evaluator. A booking (from /book or
 * from GoHighLevel) goes to the free evaluator whose territory it is, then
 * by the usual rules: already going that way, the lighter day, whoever has
 * waited longest. Nobody whose territory it is free means anybody free gets
 * it, so a territory never costs a client their time.
 *
 * Three screens, one load: what needs you (under the choice's Needs you),
 * how routing is doing, and the territories themselves.
 */

const loadTerritories = cache(async () => {
  const data = await loadTerritoriesPanel(await getCurrentOrganizationId());
  const withTerritory = data.evaluators.filter((e) => e.territory && (e.territory.zips.length || e.territory.areas.length));
  return { data, withTerritory };
});

export async function TerritoriesNeedsPanel() {
  const { data, withTerritory } = await loadTerritories();
  const needs = [
    ...(!data.ready ? [{ id: "setup", summary: "Territories aren't set up yet: migration 0361 has to be applied first." }] : []),
    ...withTerritory
      .filter((e) => e.bookings >= 5 && e.inTerritory / e.bookings < 0.5)
      .map((e) => ({ id: e.id, open: { kind: "sales.evaluator", id: e.id }, summary: `${e.name} did ${e.bookings - e.inTerritory} of ${e.bookings} evaluations outside their territory.`, detail: "Either the territory is drawn too small, or nobody covers where the work is." })),
  ];

  return (
    <PanelSection title="Territories">
      <NeedsYouStrip items={needs} empty="Routing is working: bookings are landing with whoever covers them." />
    </PanelSection>
  );
}

export async function TerritoryRoutingPanel() {
  const { data, withTerritory } = await loadTerritories();
  const total = data.evaluators.reduce((s, e) => s + e.bookings, 0);
  const inside = withTerritory.reduce((s, e) => s + e.inTerritory, 0);
  const outside = withTerritory.reduce((s, e) => s + e.bookings - e.inTerritory, 0);

  return (
    <PanelSection title="Routing" sub="The last 90 days of evaluations.">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile label="Evaluators with a territory" value={`${withTerritory.length} of ${data.evaluators.length}`} target="optional" tone="neutral" />
        <KpiTile
          label="Booked inside territory"
          value={withTerritory.length ? pct(inside / Math.max(1, inside + outside)) : "—"}
          target="≥ 80%"
          tone={!withTerritory.length || inside + outside < 5 ? "neutral" : inside / (inside + outside) >= 0.8 ? "good" : inside / (inside + outside) >= 0.5 ? "warn" : "bad"}
          note="Internal target: no published band."
        />
        <KpiTile label="Evaluations" value={String(total)} target="no band" tone="neutral" />
      </div>
    </PanelSection>
  );
}

export async function TerritoriesPanel() {
  const { data } = await loadTerritories();

  return (
    <PanelSection title="Territories" sub="Type zip codes, draw areas, or both. With none, an evaluator covers everywhere.">
      <TerritoriesEditor
        evaluators={data.evaluators.map((e) => ({
          id: e.id,
          name: e.name,
          zips: e.territory?.zips ?? [],
          areas: e.territory?.areas ?? [],
          active: e.territory?.active ?? true,
          bookings: e.bookings,
          inTerritory: e.inTerritory,
        }))}
        pins={data.pins}
      />
    </PanelSection>
  );
}
