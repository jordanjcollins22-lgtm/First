import type { SupabaseClient } from "@supabase/supabase-js";

import { playPolicy, type PlayReview } from "@/lib/marketing-approval";
import type { MarketingPlay } from "@/lib/marketing-plays";
import { mayActOn, type AutopilotSettings, type StartedMap } from "@/lib/marketing/autopilot-settings";
import { decideClosure, playCostCents, type ClosableKind, type TrailPoint } from "@/lib/marketing/play-closure";

/**
 * The plays looking after themselves: approved when they look like what the
 * business approves, closed when walked or finished, expired when forgotten,
 * and costed when they close.
 *
 * Works with any client: the page passes the signed-in one, the cron the
 * service role. Every write goes through the same database functions a
 * person's tap does (marketing_play_review, marketing_play_set), so a play
 * closed by the app records its doors exactly as one ticked by hand.
 */

const untyped = (c: unknown) => c as SupabaseClient;

const ACTIVE_JOB = ["approved", "in_progress"];

/** Which of these jobs are running now. */
export async function activeJobIds(client: unknown, jobIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data } = await untyped(client).from("jobs").select("id, status").in("id", ids);
  return new Set(((data ?? []) as { id: string; status: string }[]).filter((j) => ACTIVE_JOB.includes(j.status)).map((j) => j.id));
}

/**
 * Approves, on the app's behalf, the pending plays the policy says to. Each
 * one is written as an 'auto' decision with its reason, so the record says
 * why the app did it. Returns the ids approved.
 */
export async function autoApprovePlays(
  client: unknown,
  org: string,
  plays: MarketingPlay[],
  reviews: PlayReview[],
  autopilot: { settings: AutopilotSettings; started: StartedMap }
): Promise<string[]> {
  const sb = untyped(client);
  const pending = plays.filter((p) => p.status === "open" && p.approval === "pending");
  if (pending.length === 0) return [];
  const running = await activeJobIds(client, pending.map((p) => p.jobId ?? ""));
  const approved: string[] = [];
  for (const play of pending) {
    const learned = mayActOn("plays_auto_approve", autopilot.settings, autopilot.started, play.createdAt);
    const hangers = mayActOn("hangers_default_approve", autopilot.settings, autopilot.started, play.createdAt);
    if (!learned && !hangers) continue;
    const policy = playPolicy(play, learned ? reviews : [], {
      jobActive: Boolean(play.jobId && running.has(play.jobId)),
      hangersDefaultApprove: hangers,
    });
    if (policy.decision !== "auto") continue;
    const { error } = await sb.rpc("marketing_play_review", { org, the_play: play.id, decision: "auto", note: policy.why });
    if (error) {
      console.error("[marketing] could not approve on the app's behalf:", error.message);
      continue;
    }
    play.approval = "auto";
    play.approvedAt = new Date().toISOString();
    approved.push(play.id);
  }
  return approved;
}

/** Stamps how a play closed and what it cost. */
export async function stampClosed(
  client: unknown,
  play: { id: string; kind: ClosableKind; quantity: number },
  how: { reason: string; note: string; coverage?: number | null },
  settings: AutopilotSettings
): Promise<void> {
  await untyped(client)
    .from("marketing_plays")
    .update({
      closed_reason: how.reason,
      closed_note: how.note,
      coverage: how.coverage ?? null,
      cost_cents: how.reason === "expired" ? 0 : playCostCents(play.kind, play.quantity, settings.unitCostCents),
      updated_at: new Date().toISOString(),
    })
    .eq("id", play.id);
}

export interface PlayRunResult {
  approved: number;
  closed: number;
  expired: number;
}

/** One pass over a business's open plays. Safe to run twice: a closed play is no longer open. */
export async function runPlayAutopilot(
  client: unknown,
  org: string,
  autopilot: { settings: AutopilotSettings; started: StartedMap },
  now = new Date()
): Promise<PlayRunResult> {
  const sb = untyped(client);
  const [{ data: listed, error }, { data: stateRaw }] = await Promise.all([
    sb.rpc("marketing_plays_list", { org, include_done: false }),
    sb.rpc("marketing_approval_state", { org }),
  ]);
  if (error) throw error;
  const plays = ((Array.isArray(listed) ? listed : []) as MarketingPlay[]).filter((p) => p.status === "open");
  const reviews = ((stateRaw ?? {}) as { reviews?: PlayReview[] }).reviews ?? [];

  const approved = await autoApprovePlays(client, org, plays, reviews, autopilot);

  const { settings, started } = autopilot;
  const autoCloseSince = settings.enabled.plays_auto_close ? (started.plays_auto_close ?? null) : null;
  const expireSince = settings.enabled.plays_expire ? (started.plays_expire ?? null) : null;
  if (!autoCloseSince && !expireSince) return { approved: approved.length, closed: 0, expired: 0 };

  const ids = plays.map((p) => p.id);
  const jobIds = [...new Set(plays.map((p) => p.jobId).filter((j): j is string => Boolean(j)))];
  const [{ data: trailRows }, { data: finishedRows }] = await Promise.all([
    ids.length
      ? sb.from("marketing_play_trail").select("play_id, lat, lng, at").in("play_id", ids).order("at", { ascending: true }).limit(20000)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? sb.from("crew_day_events").select("job_id, at").eq("kind", "finished_job").in("job_id", jobIds).order("at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const trailBy = new Map<string, TrailPoint[]>();
  for (const r of (trailRows ?? []) as { play_id: string; lat: number; lng: number; at: string }[]) {
    const list = trailBy.get(r.play_id) ?? [];
    list.push({ lat: Number(r.lat), lng: Number(r.lng), at: r.at });
    trailBy.set(r.play_id, list);
  }
  const finishedBy = new Map<string, string>();
  for (const r of (finishedRows ?? []) as { job_id: string; at: string }[]) {
    if (!finishedBy.has(r.job_id)) finishedBy.set(r.job_id, r.at);
  }

  let closed = 0;
  let expired = 0;
  for (const play of plays) {
    const trail = trailBy.get(play.id) ?? [];
    // The doors are only worth fetching when there is a walk to check them against.
    let doors: { lat: number; lng: number }[] = [];
    if (trail.length > 0 && play.kind !== "flyers") {
      const { data } = await sb.rpc("marketing_play_doors", { the_play: play.id });
      doors = ((Array.isArray(data) ? data : []) as { lat: number; lng: number }[]).map((d) => ({ lat: Number(d.lat), lng: Number(d.lng) }));
    }
    const decision = decideClosure({
      play: {
        id: play.id,
        kind: play.kind,
        status: play.status,
        approval: play.approval,
        createdAt: play.createdAt,
        approvedAt: play.approvedAt ?? null,
        assignedAt: play.assignedAt ?? null,
        quantity: play.quantity,
      },
      doors,
      trail,
      crewFinishedAt: play.jobId ? (finishedBy.get(play.jobId) ?? null) : null,
      now,
      autoCloseSince,
      expireSince,
      expiryDays: settings.playExpiryDays,
      coverageNeeded: settings.gpsCoverage,
    });
    if (decision.action === "none") continue;

    const status = decision.action === "close" ? "done" : "skipped";
    const { data, error: setError } = await sb.rpc("marketing_play_set", {
      the_play: play.id,
      new_status: status,
      by: play.assignedTo ?? null,
      designs: 1,
    });
    const ok = !setError && (data as { ok?: boolean } | null)?.ok;
    if (!ok) {
      console.error("[marketing] could not close play:", setError?.message ?? JSON.stringify(data));
      continue;
    }
    await stampClosed(
      client,
      play,
      decision.action === "close"
        ? { reason: decision.reason, note: decision.note, coverage: decision.reason === "gps" ? decision.coverage : null }
        : { reason: "expired", note: decision.note },
      settings
    );
    if (decision.action === "close") closed++;
    else expired++;
  }
  return { approved: approved.length, closed, expired };
}
