import { Suspense } from "react";

import { outboundBaseUrl } from "@/lib/base-url";
import { listAppConnections, type AppConnection } from "@/lib/data/app-connections";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { allProviders } from "@/lib/integrations/catalog";
import { redirectUriFor } from "@/lib/integrations/oauth";
import { listIntegrations } from "@/lib/integrations/store";
import { IntegrationCard, OAuthReturnNotice, type ProviderView } from "@/components/v2/panels/integrations-client";
import { OpenButton } from "@/components/v2/panels/admin-open";

/**
 * Admin › Settings › Integrations: every login and key the business needs,
 * in one place. The owner pastes values here once; secret ones are never
 * shown again, only "saved". Below, the services the app was already wired
 * to (keys in Vercel or their own screens), read-only, with how to fix
 * whatever is missing.
 */

const AREAS = ["Marketing", "Sales", "Operations", "Admin"] as const;

export async function IntegrationsPanel() {
  const organizationId = await getCurrentOrganizationId();
  const [saved, existing, base] = await Promise.all([
    listIntegrations(organizationId).catch(() => []),
    listAppConnections(organizationId).catch(() => [] as AppConnection[]),
    outboundBaseUrl().catch(() => ""),
  ]);
  const byId = new Map(saved.map((s) => [s.provider, s]));
  const providers: ProviderView[] = allProviders().map((p) => {
    const s = byId.get(p.id);
    const settings = s?.settings ?? {};
    return {
      id: p.id,
      name: p.name,
      area: p.area,
      enables: p.enables,
      howTo: p.howTo,
      docsUrl: p.docsUrl ?? null,
      oauthStartPath: p.oauthStartPath ?? null,
      redirectUri: p.oauthStartPath && base ? redirectUriFor(base, p.id) : null,
      hasTest: Boolean(p.test),
      fields: p.fields.map((f) => ({
        key: f.key,
        label: f.label,
        secret: Boolean(f.secret),
        placeholder: f.placeholder ?? "",
        help: f.help ?? "",
        // Only non-secret values ever leave the server.
        value: f.secret ? "" : typeof settings[f.key] === "string" ? (settings[f.key] as string) : "",
        saved: f.secret ? Boolean(s?.filled.includes(f.key)) : typeof settings[f.key] === "string" && (settings[f.key] as string).length > 0,
      })),
      status: s?.status ?? "not_connected",
      connectedAt: s?.connected_at ?? null,
      lastCheckedAt: s?.last_checked_at ?? null,
      lastError: s?.last_error ?? null,
      everSaved: Boolean(s),
    };
  });

  const broken = providers.filter((p) => p.status === "error");
  const missingExisting = existing.filter((c) => c.status !== "configured");
  const connected = providers.filter((p) => p.status === "connected").length;
  const configured = existing.filter((c) => c.status === "configured").length;

  return (
    <section className="space-y-5" aria-labelledby="integrations-heading">
      <header className="space-y-1">
        <h2 id="integrations-heading" className="text-xl font-bold">
          Integrations
        </h2>
        <p className="text-sm text-muted-foreground">Every outside login the app uses. Paste a key once; secret ones are kept on the server and never shown again.</p>
      </header>

      <Suspense fallback={null}>
        <OAuthReturnNotice names={Object.fromEntries(providers.map((p) => [p.id, p.name]))} />
      </Suspense>

      {/* Needs you */}
      {(broken.length > 0 || missingExisting.length > 0) && (
        <ul className="space-y-2" aria-label="Needs you">
          {broken.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
              <span className="min-w-0 flex-1">
                <b>{p.name}</b> isn&apos;t working{p.lastError ? `: ${p.lastError}` : "."} Open it to test it, or press Connect on its card below.
              </span>
              <OpenButton kind="admin.integration" id={p.id} />
            </li>
          ))}
          {missingExisting.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <span className="min-w-0 flex-1">
                <b>{c.name}</b> is {c.status === "missing" ? "not set up" : "partly set up"}: missing {c.checks.filter((k) => !k.present && !k.optional).map((k) => k.name).join(", ")}.
              </span>
              <OpenButton kind="admin.integration" id={c.id} />
            </li>
          ))}
        </ul>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Connected here" value={`${connected} of ${providers.length}`} tone={connected === providers.length ? "good" : "warn"} />
        <Kpi label="Already wired in" value={`${configured} of ${existing.length}`} tone={configured === existing.length ? "good" : "warn"} />
        <Kpi label="Not working" value={String(broken.length)} tone={broken.length ? "bad" : "good"} />
      </div>

      {AREAS.map((area) => {
        const mine = providers.filter((p) => p.area === area);
        if (!mine.length) return null;
        return (
          <div key={area} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{area}</h3>
            <div className="grid gap-3">
              {mine.map((p) => (
                <IntegrationCard key={p.id} provider={p} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Already wired in (read-only)</h3>
        <p className="text-sm text-muted-foreground">
          These were connected before this page existed. Their keys live in the server&apos;s environment (Vercel) or their own settings screen. This shows only whether each is set — never the value.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {existing.map((c) => (
            <ExistingCard key={c.id} c={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  const ring = tone === "good" ? "border-emerald-300 dark:border-emerald-800" : tone === "warn" ? "border-amber-300 dark:border-amber-800" : "border-red-300 dark:border-red-800";
  return (
    <div className={`rounded-xl border bg-card p-3 ${ring}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl">{value}</div>
    </div>
  );
}

const STATUS_STYLE: Record<AppConnection["status"], string> = {
  configured: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  missing: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
};
const STATUS_LABEL: Record<AppConnection["status"], string> = { configured: "Configured", partial: "Partly set", missing: "Missing" };

function ExistingCard({ c }: { c: AppConnection }) {
  return (
    <details className="rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 p-4">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{c.what}</span>
          {c.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{c.detail}</span>}
        </span>
      </summary>
      <div className="space-y-3 border-t px-4 pb-4 pt-3 text-sm">
        <div className="text-xs text-muted-foreground">Kept in: {c.where}</div>
        <ul className="space-y-1">
          {c.checks.map((k) => (
            <li key={k.name} className="flex items-start gap-2">
              <span aria-hidden className={k.present ? "text-emerald-600" : k.optional ? "text-muted-foreground" : "text-red-600"}>
                {k.present ? "✓" : "✗"}
              </span>
              <span className="font-mono text-xs break-all">{k.name}</span>
              <span className="text-xs text-muted-foreground">{k.present ? "set" : k.optional ? "optional, not set" : "missing"}</span>
            </li>
          ))}
        </ul>
        {c.status !== "configured" && (
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            {c.fix.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        )}
        <OpenButton kind="admin.integration" id={c.id} />
      </div>
    </details>
  );
}
