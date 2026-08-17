import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getPipeline, type PipelineCard } from "@/lib/data/pipeline";
import { STAGES, STAGE_STATUSES } from "@/lib/pipeline";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(value: string): string {
  return new Date(value.length > 10 ? value : `${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Every live job, in the stage it's actually in. */
export default async function PipelinePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("pipeline", "/attractors");

  let cards: PipelineCard[] = [];
  try {
    cards = await getPipeline();
  } catch (err) {
    console.error("Pipeline failed to load:", err);
  }

  const totalValue = cards
    .filter((c) => c.stage !== "operations" && c.value)
    .reduce((sum, c) => sum + (c.value ?? 0), 0);
  const needsAction = cards.filter((c) => c.actionable).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Pipeline</h1>
      <p className="mb-4 text-muted-foreground">
        Every live job, from going out to look at it through to finishing the work.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Live jobs" value={String(cards.length)} />
        <Tile label="Needs action" value={String(needsAction)} hint="Waiting on us, not the client" />
        <Tile label="Quoted, not yet won" value={money(totalValue)} />
      </div>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Nothing in the pipeline yet. Jobs appear here the moment one is created.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {STAGES.map((stage) => {
            const inStage = cards.filter((c) => c.stage === stage.key);
            const stageValue = inStage.reduce((sum, c) => sum + (c.value ?? 0), 0);

            return (
              <section
                key={stage.key}
                className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md"
              >
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{stage.label}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {inStage.length}
                    {stageValue > 0 && ` · ${money(stageValue)}`}
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-muted-foreground">{stage.blurb}</p>

                {inStage.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing here right now.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Grouped by status, in the order work moves through the
                        stage, so the board reads as progress rather than a pile. */}
                    {STAGE_STATUSES[stage.key].map((status) => {
                      const group = inStage.filter((c) => c.status === status);
                      if (group.length === 0) return null;

                      return (
                        <div key={status}>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {status} ({group.length})
                          </p>
                          <ul className="flex flex-col gap-1.5">
                            {group.map((card) => (
                              <li key={card.jobId}>
                                <Link
                                  href={`/jobs/${card.jobId}`}
                                  className={`block rounded-lg border p-2 text-sm hover:bg-accent/50 ${
                                    card.actionable
                                      ? "border-primary/40 bg-primary/5"
                                      : "border-border bg-background/50"
                                  }`}
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="truncate font-medium">{card.customerName}</span>
                                    {card.value != null && (
                                      <span className="shrink-0 text-xs tabular-nums">{money(card.value)}</span>
                                    )}
                                  </div>
                                  <p className="truncate text-xs text-muted-foreground">{card.address}</p>
                                  {card.date && (
                                    <p className="text-[11px] text-muted-foreground">{formatDate(card.date)}</p>
                                  )}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        A job&apos;s stage is read from its own status, its evaluation, and its proposal rather than stored
        separately — so it can never disagree with the job itself. Highlighted cards are waiting on us; plain
        ones are waiting on the client.
      </p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
