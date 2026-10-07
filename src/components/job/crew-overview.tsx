"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SiteMapImage } from "@/components/proposal/site-map-image";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { THUMBNAIL } from "@/lib/storage-image-url";
import { formatPhone } from "@/lib/post-sorting";
import { isKeepLine, mapColorByZone, type CrewStage } from "@/lib/crew-overview";
import type { WorkOrderZone } from "@/lib/work-order";
import type { AreaState } from "@/lib/area-work";
import type { CanvasMark } from "@/lib/canvas-marks";
import type { ScopeChange } from "@/lib/data/exceptions";
import type { JobStatus, ProposalSiteImageTransform } from "@/types/domain";

type Progress = { label: string; tone: "done" | "working" | "waiting" | "open"; detail: string | null };

const TONE: Record<Progress["tone"], string> = {
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  working: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  waiting: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  open: "bg-muted text-muted-foreground",
};

function progressFor(state: AreaState | undefined, hasAfter: boolean): Progress {
  if (hasAfter || state?.status === "done") return { label: "Done", tone: "done", detail: null };
  if (state?.status === "working") {
    const who = state.people.map((p) => p.name).join(", ");
    return {
      label: "Under way",
      tone: "working",
      detail: [who, state.stepsTotal ? `${state.stepsDone} of ${state.stepsTotal} steps` : null].filter(Boolean).join(" · "),
    };
  }
  if (state?.status === "waiting") return { label: "Waiting", tone: "waiting", detail: state.waitingReason };
  return { label: "Not started", tone: "open", detail: null };
}

function formatDay(day: string | null): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const STATUS_LABEL: Partial<Record<JobStatus, string>> = {
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
};

/**
 * The manager's crew sheet. See the page for why it exists; this draws it:
 * the map coloured by stage, where the job is up to, and every area's
 * instructions grouped into the stages they are worked in.
 */
export function CrewOverview(props: {
  jobId: string;
  jobNumber: number | null;
  jobName: string;
  address: string;
  customerName: string;
  customerPhone: string | null;
  jobStatus: JobStatus;
  startsOn: string | null;
  accountManager: { name: string; phone: string | null } | null;
  zones: WorkOrderZone[];
  areaStates: AreaState[];
  afterZoneIds: string[];
  stages: CrewStage[];
  sodSqFt: number;
  marks: CanvasMark[];
  additions: ScopeChange[];
  siteImagePath: string | null;
  imageTransform: ProposalSiteImageTransform | null;
  frame: { x: number; y: number; width: number; height: number };
}) {
  const { jobId, zones, stages } = props;
  const [picked, setPicked] = useState<number | null>(null);

  const stateBy = new Map(props.areaStates.map((s) => [s.zoneId, s]));
  const afters = new Set(props.afterZoneIds);
  const progress = zones.map((z) => progressFor(stateBy.get(z.id), afters.has(z.id)));
  const doneCount = progress.filter((p) => p.tone === "done").length;
  const colors = mapColorByZone(stages, zones.length);
  const bushes = zones.reduce((sum, z) => {
    const qty = z.service.toLowerCase().includes("trim") ? Number(z.tasks.find((t) => /quantity/i.test(t.label))?.value) : NaN;
    return Number.isFinite(qty) ? sum + qty : sum;
  }, 0);

  const pick = (index: number) => {
    setPicked(index);
    document.getElementById(`area-${zones[index].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const facts = [
    { value: zones.length, label: zones.length === 1 ? "work area" : "work areas" },
    props.sodSqFt > 0 ? { value: props.sodSqFt.toLocaleString(), label: "sq ft sod or seed" } : null,
    bushes > 0 ? { value: bushes, label: "bushes to trim" } : null,
    { value: `${doneCount}/${zones.length}`, label: "areas done" },
  ].filter(Boolean) as { value: string | number; label: string }[];

  const confirm = [
    ...props.additions.map((a) => ({ id: a.id, head: "Added since the sale", text: a.requestedNote })),
    ...props.marks.map((m) => ({ id: m.id, head: m.authorName ? `Note from ${m.authorName}` : "Evaluator's note", text: m.note })),
  ].filter((c) => c.text?.trim());

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Link href={`/jobs/${jobId}`} className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to the job
      </Link>

      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Crew sheet · manager view{props.jobNumber != null && ` · Job #${props.jobNumber}`} · {props.jobName}
        </p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-balance">{props.address}</h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>
            Client <b className="font-semibold text-foreground">{props.customerName}</b>
          </span>
          {formatDay(props.startsOn) && (
            <span>
              Start <b className="font-semibold text-foreground">{formatDay(props.startsOn)}</b>
            </span>
          )}
          {props.customerPhone && (
            <span>
              Client phone <b className="font-semibold text-foreground select-all">{formatPhone(props.customerPhone)}</b>
            </span>
          )}
          {props.accountManager && (
            <span>
              Account manager <b className="font-semibold text-foreground">{props.accountManager.name}</b>
              {props.accountManager.phone && <span className="select-all"> {formatPhone(props.accountManager.phone)}</span>}
            </span>
          )}
          <span>
            Status <b className="font-semibold text-foreground">{STATUS_LABEL[props.jobStatus] ?? props.jobStatus}</b>
          </span>
        </div>
        <Link href={`/jobs/${jobId}/work-order`} className="self-start text-sm font-medium text-primary hover:underline">
          Open the crew&apos;s view, one area at a time
        </Link>
      </header>

      {confirm.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
          <h2 className="text-base font-bold">Go over these with the crew before they start</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {confirm.map((c) => (
              <li key={c.id}>
                <b>{c.head}:</b> {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          {props.siteImagePath && props.imageTransform ? (
            <SiteMapImage
              imagePath={props.siteImagePath}
              transform={props.imageTransform}
              frame={props.frame}
              zones={zones.map((z, i) => ({ zoneName: z.name, color: colors[i], points: z.points, number: i + 1 }))}
              numbered
              showLegend={false}
              onZoneClick={pick}
              className="w-full rounded-lg border border-border bg-muted"
            />
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">No site photo on this job.</p>
          )}
          <p className="text-xs text-muted-foreground">Each area is coloured by its stage. Tap an area or its number to jump to its instructions.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {doneCount} of {zones.length} areas done
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${zones.length ? (100 * doneCount) / zones.length : 0}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {facts.map((f) => (
              <div key={f.label} className="rounded-md border border-border bg-card px-3 py-2">
                <b className="block text-2xl font-bold tabular-nums">{f.value}</b>
                <span className="text-xs text-muted-foreground">{f.label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Work order</p>
            <ol className="flex flex-col gap-2">
              {stages.map((stage, s) => (
                <li key={stage.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  <span className="h-3.5 w-3.5 rounded-sm" style={{ background: stage.color }} />
                  <span>
                    <b>Stage {s + 1}.</b> {stage.title}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {stage.zones.length} area{stage.zones.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {stages.map((stage, s) => {
        const sod = stage.key === "finish";
        return (
          <section key={stage.key} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b-[3px] pb-1.5" style={{ borderColor: stage.color }}>
              <span className="text-2xl font-bold" style={{ color: stage.color }}>
                Stage {s + 1}
              </span>
              <h2 className="text-2xl font-bold">{stage.title}</h2>
              <p className="basis-full text-sm text-muted-foreground">{stage.note}</p>
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
              {stage.zones.map((i) => {
                const z = zones[i];
                const p = progress[i];
                const firstStage = colors[i] === stage.color && !sod;
                return (
                  <article
                    key={z.id}
                    id={firstStage ? `area-${z.id}` : undefined}
                    className={`flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-md border border-l-[5px] border-border bg-card px-3.5 py-3 ${
                      picked === i ? "ring-2 ring-offset-2 ring-offset-background" : ""
                    } ${p.tone === "done" ? "opacity-60" : ""}`}
                    style={{ borderLeftColor: stage.color, ...(picked === i ? { ["--tw-ring-color" as string]: stage.color } : {}) }}
                  >
                    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5">
                      <span className="whitespace-nowrap rounded px-2 py-0.5 text-sm font-bold text-white" style={{ background: stage.color }}>
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-snug">{sod ? (stage.finish?.[i] === "seed" ? "Seed" : "Install sod") : z.service}</h3>
                        <p className="text-sm text-muted-foreground">{[z.name, z.location].filter(Boolean).join(" · ")}</p>
                      </div>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[p.tone]}`}>{p.label}</span>
                    </div>
                    {p.detail && <p className="text-xs text-muted-foreground">{p.detail}</p>}

                    {sod ? (
                      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
                        <li>Once this area is cleared and hauled, rake it level.</li>
                        {stage.finish?.[i] === "seed" ? (
                          <li>Spread topsoil where it&apos;s low, seed it and cover it with straw.</li>
                        ) : (
                          <li>Lay the sod with tight, staggered seams.</li>
                        )}
                        <li>{stage.finish?.[i] === "seed" ? "Water it in." : "Roll it and water it in."}</li>
                      </ul>
                    ) : (
                      <>
                        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
                          {z.todo.filter((line) => !isKeepLine(line)).map((line, k) => (
                            <li key={k}>{line}</li>
                          ))}
                        </ul>
                        {z.todo.filter(isKeepLine).map((line, k) => (
                          <p key={k} className="rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                            {line}
                          </p>
                        ))}
                        {z.notes && <p className="text-sm italic text-muted-foreground">&ldquo;{z.notes}&rdquo;</p>}
                      </>
                    )}

                    {z.sizeLabel && <p className="text-xs tabular-nums text-muted-foreground">{z.sizeLabel}</p>}

                    {!sod && z.photos.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                        {z.photos.map((photo, k) => (
                          <a key={photo.path} href={canvasImageUrl(photo.path)} target="_blank" rel="noreferrer" className="flex-none">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={canvasImageUrl(photo.path, THUMBNAIL)}
                              alt={`${z.name} photo ${k + 1}`}
                              loading="lazy"
                              className="h-20 w-auto rounded border border-border"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
