"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pause, Play, Radar, ShieldCheck, Search, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  pauseGisImport,
  resumeGisImport,
  runIntegrityChecks,
  startGisImport,
  testGisConnection,
  verifyKnownHouse,
  type KnownHouseCheck,
} from "@/lib/actions/gis-import-actions";
import type { GisImportJob } from "@/lib/data/gis-import";

/**
 * The controls for the county import, and the record of every run.
 *
 * The screen never talks to the county. Every button calls a server action;
 * every number on it was written by a server process; and while an import is
 * running the page simply re-reads itself every few seconds. So what is shown
 * is what the database says happened, not what the browser hopes did.
 */

const KNOWN_HOUSE = "1550 Swearingen Drive, Bel Air, MD 21014";

interface Props {
  jobs: GisImportJob[];
  defaultUrl: string;
  /** Whether CRON_SECRET is set, without which no background step can run. */
  backgroundReady: boolean;
}

export function GisImportConsole({ jobs, defaultUrl, backgroundReady }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState(defaultUrl);
  const [zip, setZip] = useState("21014");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [knownAddress, setKnownAddress] = useState(KNOWN_HOUSE);
  const [known, setKnown] = useState<KnownHouseCheck | null>(null);

  const running = jobs.find((j) => j.status === "running");
  const latestTest = jobs.find((j) => j.kind === "connection_test");
  const latestImport = jobs.find((j) => j.kind !== "connection_test");
  const canImport = Boolean(latestTest?.status === "done" && latestTest.layer_url);

  // Watch a running import by re-reading the page. The server owns the
  // numbers; polling them is the only honest way to show progress.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [running, router]);

  function run(work: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't work.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Stage one: the connection. */}
      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-1 font-semibold">1. Connection</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          One request to the county&apos;s server, made from this app&apos;s own server. Paste the
          address layer, the service, or the catalog above it; the app finds the layer and reads its
          fields from what the server actually says.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/rest/services/…/MapServer/0"
            className="font-mono text-xs"
          />
          <Button type="button" disabled={isPending || !url.trim()} onClick={() => run(() => testGisConnection(url))}>
            {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Radar className="mr-1 h-4 w-4" />}
            Test connection
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {latestTest && <ConnectionResult job={latestTest} onPick={setUrl} />}
      </section>

      {/* Stages two and five: imports. */}
      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-1 font-semibold">2. Import</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Runs on the server in the background and can be paused, resumed and re-run. A second run
          changes nothing: houses we hold are enriched, never duplicated; the raw address and every
          event on a house are never touched.
        </p>
        {!backgroundReady && (
          <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            CRON_SECRET is not set on the server, so background steps cannot run yet.
          </p>
        )}
        {!canImport && (
          <p className="mb-3 text-sm text-muted-foreground">
            The connection test has to find an address layer before an import can start.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="zip" className="text-xs">
              ZIP
            </Label>
            <Input id="zip" value={zip} onChange={(e) => setZip(e.target.value)} className="w-28" inputMode="numeric" />
          </div>
          <Button
            type="button"
            disabled={isPending || !canImport || !backgroundReady || Boolean(running)}
            onClick={() => run(() => startGisImport({ serviceUrl: url, scope: "zip", zip }))}
          >
            Import ZIP {zip || "…"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending || !canImport || !backgroundReady || Boolean(running)}
            onClick={() => {
              if (!window.confirm("Import every address in Harford County? This runs for a while in the background.")) return;
              run(() => startGisImport({ serviceUrl: url, scope: "county" }));
            }}
          >
            Import whole county
          </Button>
        </div>

        {latestImport && (
          <ImportStatus
            job={latestImport}
            busy={isPending}
            onPause={() => run(() => pauseGisImport(latestImport.id))}
            onResume={() => run(() => resumeGisImport(latestImport.id))}
          />
        )}
      </section>

      {/* Stages four and eight: proof. */}
      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-1 font-semibold">3. Prove it</h2>
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm text-muted-foreground">
              A house we know, looked up by the same key the importer uses. Its id and its history
              must be exactly what they were.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={knownAddress} onChange={(e) => setKnownAddress(e.target.value)} className="text-sm" />
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => run(async () => setKnown(await verifyKnownHouse(knownAddress)))}
              >
                <Search className="mr-1 h-4 w-4" />
                Verify
              </Button>
            </div>
            {known && <KnownHouse check={known} />}
          </div>

          <div>
            <p className="mb-2 text-sm text-muted-foreground">
              The integrity questions: duplicate addresses, duplicate parcel links, houses with no
              usable pin, county houses with no address, events with no house, and what is waiting in
              review. Everything but the totals and the review count should be zero.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => run(async () => setReport((await runIntegrityChecks()) as Record<string, unknown>))}
            >
              <ShieldCheck className="mr-1 h-4 w-4" />
              Run integrity checks
            </Button>
            {(report ?? (latestImport?.after_totals as Record<string, unknown> | null)) && (
              <Totals
                before={latestImport?.before_totals as Record<string, unknown> | null}
                after={(report ?? latestImport?.after_totals) as Record<string, unknown>}
              />
            )}
          </div>
        </div>
      </section>

      {jobs.length > 1 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Earlier runs</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {jobs.slice(0, 8).map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                <StatusBadge status={job.status} />
                <span className="font-medium">{describeKind(job)}</span>
                <span className="text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span>
                {job.kind !== "connection_test" && (
                  <span className="text-muted-foreground">
                    {job.fetched.toLocaleString()} fetched · {job.created} created · {job.matched} matched
                  </span>
                )}
                {job.last_error && <span className="text-destructive">{job.last_error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function describeKind(job: GisImportJob): string {
  if (job.kind === "connection_test") return "Connection test";
  const scope = (job.scope ?? {}) as { zip?: string };
  return job.kind === "zip" ? `ZIP ${scope.zip ?? ""}` : "Whole county";
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "done" ? "default" : status === "failed" ? "destructive" : status === "running" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {status === "running" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {status}
    </Badge>
  );
}

interface Probe {
  at?: string;
  url?: string;
  ok?: boolean;
  kind?: string;
  status?: number | null;
  statusText?: string | null;
  errorCode?: string | null;
  message?: string | null;
  bodySnippet?: string | null;
  elapsedMs?: number;
  origin?: { platform?: string; environment?: string | null; region?: string | null; runtime?: string; node?: string };
}

/** What the connection test found, or exactly why it did not. */
function ConnectionResult({ job, onPick }: { job: GisImportJob; onPick: (url: string) => void }) {
  const probes = (Array.isArray(job.diagnostics) ? job.diagnostics : []) as Probe[];
  const fields = (Array.isArray(job.discovered_fields) ? job.discovered_fields : []) as { name: string; type: string; alias?: string | null }[];
  const mapping = (job.field_mapping ?? null) as Record<string, string | null> | null;
  const found = (job.layers_found ?? {}) as {
    kind?: string;
    services?: string[];
    folders?: string[];
    layers?: { id: number; name: string; type: string | null }[];
    geometryType?: string | null;
    supportsPagination?: boolean;
  };
  const last = probes[probes.length - 1];

  return (
    <div className="mt-4 flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {job.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="font-medium">
          {job.status === "done" ? `Layer found: ${job.layer_name ?? job.layer_url}` : job.last_error ?? "Did not connect."}
        </span>
        <span className="text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span>
      </div>

      {job.status === "done" && (
        <p className="text-xs text-muted-foreground">
          {job.layer_url} · {found.geometryType ?? "geometry unknown"} · up to {job.max_record_count ?? "?"} per page ·
          paging {found.supportsPagination ? "supported" : "not advertised"}
        </p>
      )}

      {/* The request itself, every time. This is the diagnosis when it failed. */}
      {probes.length > 0 && (
        <details open={job.status !== "done"} className="rounded-lg bg-muted/40 p-3">
          <summary className="cursor-pointer font-medium">
            {probes.length} request{probes.length === 1 ? "" : "s"}
            {last?.origin && (
              <span className="ml-2 font-normal text-muted-foreground">
                from {last.origin.platform}
                {last.origin.region ? ` (${last.origin.region})` : ""}
                {last.origin.environment ? ` · ${last.origin.environment}` : ""} · {last.origin.runtime}
              </span>
            )}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {probes.map((p, i) => (
              <li key={i} className="rounded-md border border-border bg-background p-2 font-mono text-xs">
                <div className="break-all">{p.url}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span>{p.ok ? "ok" : `failed: ${p.kind}`}</span>
                  <span>HTTP {p.status ?? "—"}{p.statusText ? ` ${p.statusText}` : ""}</span>
                  {p.errorCode && <span>code {p.errorCode}</span>}
                  <span>{p.elapsedMs ?? "?"} ms</span>
                  <span>origin {p.origin?.platform ?? "?"}{p.origin?.region ? `/${p.origin.region}` : ""}</span>
                  <span>node {p.origin?.node ?? "?"}</span>
                  <span>cors n/a (server)</span>
                </div>
                {p.message && <div className="mt-1 text-destructive">{p.message}</div>}
                {p.bodySnippet && !p.ok && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-1.5">
                    {p.bodySnippet}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {found.kind === "catalog" && (found.services?.length || found.folders?.length) ? (
        <div>
          <p className="mb-1 font-medium">Services on this server</p>
          <div className="flex flex-wrap gap-1">
            {(found.folders ?? []).map((folder) => (
              <Button key={folder} type="button" size="sm" variant="outline" onClick={() => onPick(`${job.service_url}/${folder}`)}>
                {folder}/
              </Button>
            ))}
            {(found.services ?? []).map((service) => (
              <Button key={service} type="button" size="sm" variant="secondary" onClick={() => onPick(`${job.service_url}/${service}`)}>
                {service}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Pick one, then test again.</p>
        </div>
      ) : null}

      {found.layers && found.layers.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Layers in this service</p>
          <div className="flex flex-wrap gap-1">
            {found.layers.map((layer) => (
              <Button
                key={layer.id}
                type="button"
                size="sm"
                variant={job.layer_url?.endsWith(`/${layer.id}`) ? "default" : "outline"}
                onClick={() => onPick(`${job.service_url.replace(/\/\d+$/, "")}/${layer.id}`)}
              >
                {layer.id}: {layer.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {mapping && (
        <div>
          <p className="mb-1 font-medium">What the import will read</p>
          <table className="text-xs">
            <tbody>
              {Object.entries(mapping).map(([role, field]) => (
                <tr key={role}>
                  <td className="pr-3 py-0.5 text-muted-foreground">{role}</td>
                  <td className="py-0.5 font-mono">{field ?? <span className="text-muted-foreground">— not present</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fields.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">All {fields.length} fields the layer reports</summary>
          <div className="mt-1 flex flex-wrap gap-1 font-mono">
            {fields.map((f) => (
              <span key={f.name} className="rounded bg-muted px-1.5 py-0.5" title={f.alias ?? undefined}>
                {f.name}
                <span className="text-muted-foreground">:{f.type.replace("esriFieldType", "")}</span>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Fetched / Processed / Matched / Created / Review / Skipped / Errors, live. */
function ImportStatus({
  job,
  busy,
  onPause,
  onResume,
}: {
  job: GisImportJob;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const checkpoint = (job.checkpoint ?? {}) as { offset?: number };
  const expected = job.total_expected ?? null;
  const percent = expected && expected > 0 ? Math.min(100, Math.round((job.fetched / expected) * 100)) : null;

  const counters = [
    { label: "Fetched", value: job.fetched },
    { label: "Processed", value: job.processed },
    { label: "Matched", value: job.matched },
    { label: "Created", value: job.created },
    { label: "Review", value: job.review },
    { label: "Skipped", value: job.skipped },
    { label: "Duplicates prevented", value: job.duplicates_prevented },
    { label: "Errors", value: job.errors },
  ];

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={job.status} />
        <span className="font-medium">{describeKind(job)}</span>
        <span className="text-muted-foreground">
          started {new Date(job.started_at).toLocaleString()}
          {job.finished_at && ` · finished ${new Date(job.finished_at).toLocaleString()}`}
        </span>
        <span className="ml-auto flex gap-2">
          {job.status === "running" && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onPause}>
              <Pause className="mr-1 h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {(job.status === "paused" || job.status === "failed") && (
            <Button type="button" size="sm" disabled={busy} onClick={onResume}>
              <Play className="mr-1 h-3.5 w-3.5" /> Resume from {(checkpoint.offset ?? 0).toLocaleString()}
            </Button>
          )}
        </span>
      </div>

      {percent != null ? (
        <div>
          <Progress value={percent} />
          <p className="mt-1 text-xs text-muted-foreground">
            {job.fetched.toLocaleString()} of {expected?.toLocaleString()} · {percent}% · step {job.steps}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {job.fetched.toLocaleString()} fetched · step {job.steps} · offset {(checkpoint.offset ?? 0).toLocaleString()}
        </p>
      )}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {counters.map((c) => (
          <div key={c.label} className="rounded-lg border border-border p-2 text-center">
            <p className={`text-lg font-bold ${c.label === "Errors" && c.value > 0 ? "text-destructive" : ""}`}>
              {c.value.toLocaleString()}
            </p>
            <p className="text-[11px] leading-tight text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>

      {job.last_error && <p className="text-sm text-destructive">{job.last_error}</p>}
    </div>
  );
}

const TOTAL_LABELS: Record<string, string> = {
  total_houses: "Houses",
  gis_linked_houses: "Linked to a county parcel",
  total_events: "Events",
  duplicate_normalized_addresses: "Duplicate addresses",
  duplicate_parcel_ids: "Duplicate parcel links",
  houses_without_usable_coordinates: "Houses without a usable pin",
  gis_houses_without_address: "County houses without an address",
  gis_houses_without_normalized: "County houses without a key",
  detached_events: "Events with no house",
  pending_reviews: "Waiting in review",
  held_houses: "Held off the map",
};

const MUST_BE_ZERO = new Set([
  "duplicate_normalized_addresses",
  "duplicate_parcel_ids",
  "gis_houses_without_address",
  "gis_houses_without_normalized",
  "detached_events",
]);

function Totals({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> }) {
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-medium">Check</th>
          <th className="py-1 font-medium">Before</th>
          <th className="py-1 font-medium">Now</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(TOTAL_LABELS).map(([key, label]) => {
          const now = Number(after[key] ?? 0);
          const then = before ? Number(before[key] ?? 0) : null;
          const bad = MUST_BE_ZERO.has(key) && now > 0;
          return (
            <tr key={key} className="border-t border-border">
              <td className="py-1">{label}</td>
              <td className="py-1 text-muted-foreground">{then == null ? "—" : then.toLocaleString()}</td>
              <td className={`py-1 font-medium ${bad ? "text-destructive" : ""}`}>
                {now.toLocaleString()}
                {MUST_BE_ZERO.has(key) && !bad && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-green-600" />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function KnownHouse({ check }: { check: KnownHouseCheck }) {
  if (!check.found) {
    return <p className="mt-2 text-sm text-destructive">No house has the key {check.normalized}.</p>;
  }
  const rows: [string, string][] = [
    ["House id", check.id ?? ""],
    ["Raw address", check.address ?? ""],
    ["Matching key", check.normalized],
    ["County parcel", check.parcelId ? `${check.parcelId} · ${check.gisAddress ?? ""}` : "not linked yet"],
    ["History", `${check.eventCount} event${check.eventCount === 1 ? "" : "s"}${check.eventKinds.length ? ` (${check.eventKinds.join(", ")})` : ""} · ${check.contactCount} contact${check.contactCount === 1 ? "" : "s"}${check.propertyId ? " · linked to a property" : ""}`],
    ["Rows with this key", String(check.rowsWithThisKey)],
  ];
  return (
    <table className="mt-2 text-sm">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="pr-3 py-0.5 text-muted-foreground">{label}</td>
            <td className={`py-0.5 font-mono text-xs ${label === "Rows with this key" && check.rowsWithThisKey !== 1 ? "text-destructive" : ""}`}>
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
