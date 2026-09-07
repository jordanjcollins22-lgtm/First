"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MapPin, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { approveZones, reviewZone } from "@/lib/actions/zone-approval-actions";
import type { ZoneApprovalState } from "@/lib/data/zone-approval";
import { approvalQueue, describeTrust, REJECT_REASONS, summarizeApprovals, type RejectReason } from "@/lib/zone-approval";
import { crewFor, formatMinutes, MODE_COLOR, MODE_LABEL, modeOf, type ZoneMode } from "@/lib/zones";

/**
 * The zones waiting for a person's word.
 *
 * One at a time: Show puts the zone and its walk on the map, Approve
 * puts it on the map for good, Fix says what is wrong. The panel says
 * how much the app is still asking, and that shrinks as approvals pile
 * up without a correction.
 */
export function ZoneApprovalPanel({ state, onFocusZone }: { state: ZoneApprovalState; onFocusZone: (id: string) => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [reason, setReason] = useState<RejectReason>("mode");
  const [newMode, setNewMode] = useState<ZoneMode>("foot");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [bulk, setBulk] = useState(false);

  const queue = approvalQueue(state.zones);
  const summary = summarizeApprovals(state.zones);
  const visible = showAll ? queue : queue.slice(0, 6);

  function approveMany(ids: string[]) {
    setError(null);
    setBulk(true);
    startTransition(async () => {
      const result = await approveZones(ids);
      setBulk(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function decide(zoneId: string, decision: "approve" | "reject") {
    setError(null);
    setBusy(zoneId);
    startTransition(async () => {
      const result = await reviewZone({ zoneId, decision, reason: decision === "reject" ? reason : undefined, note: decision === "reject" ? note : undefined, newMode: decision === "reject" && reason === "mode" ? newMode : undefined });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFixing(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" /> Zones to approve
          <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{summary.waiting}</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A zone goes on the map once you say it is right. {summary.approved} approved ({summary.byPerson} by you, {summary.byApp} by the app), {summary.waiting} waiting
          {summary.rejected > 0 ? `, ${summary.rejected} sent back` : ""}.
          {state.autoApproved > 0 ? ` The app approved ${state.autoApproved} just now because they look like ones you approved.` : ""}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{describeTrust(state.streak)}</p>
      </div>
      {queue.length > 1 && (
        <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
          <p className="text-xs">
            <span className="font-medium">{queue.length} waiting.</span>{" "}
            <span className="text-muted-foreground">
              None of them are on the map yet. Look down the list, and if they are right, approve them together rather than one at a time — the first ten are what teach the app, and after that it approves the ordinary ones itself.
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-7" disabled={bulk} onClick={() => approveMany(visible.map((z) => z.id))}>
              {bulk ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Approve the {visible.length} shown
            </Button>
            {queue.length > visible.length && (
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={bulk} onClick={() => approveMany(queue.slice(0, 100).map((z) => z.id))}>
                Approve all {Math.min(queue.length, 100)}
              </Button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {queue.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing waiting. New or changed zones will appear here before they go on the map.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((z) => {
            const mode = modeOf(z.mode);
            const working = busy === z.id && isPending;
            const open = fixing === z.id;
            return (
              <li key={z.id} className={`rounded-lg border p-2.5 ${z.approval === "rejected" ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background/60"}`}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: mode ? MODE_COLOR[mode] : "#94a3b8" }} title={mode ? MODE_LABEL[mode] : ""} />
                  <span className="font-medium">{z.name}</span>
                  {z.active && <span className="rounded bg-emerald-600/15 px-1 text-[10px] font-medium text-emerald-700">our work in it</span>}
                  {z.isPart && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">split part</span>}
                  <button type="button" className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline" onClick={() => onFocusZone(z.id)} title="Show the zone and its walk">
                    <MapPin className="h-3 w-3" /> Show
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mode ? MODE_LABEL[mode] : "Not rated"} · {z.houses.toLocaleString()} doors · {formatMinutes(z.minutes)} · {crewFor(z.minutes)} people
                  {z.gapM != null ? ` · ${Math.round(z.gapM)} m between doors` : ""}
                  {z.approval === "rejected" ? ` · sent back${z.note ? `: ${z.note}` : ""}, rebuilt since` : ""}
                </p>
                {!open ? (
                  <div className="mt-1.5 flex gap-2">
                    <Button type="button" size="sm" className="h-7" disabled={working} onClick={() => decide(z.id, "approve")}>
                      {working ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Approve
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-7" disabled={working} onClick={() => { setFixing(z.id); setReason("mode"); setNewMode(mode === "foot" ? "scooter" : "foot"); }}>
                      <X className="mr-1 h-3 w-3" /> Fix
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1.5 space-y-1.5 text-xs">
                    <select value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} className="h-7 w-full rounded-md border border-border bg-background px-2">
                      {REJECT_REASONS.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground">{REJECT_REASONS.find((r) => r.key === reason)?.blurb}</p>
                    {reason === "mode" && (
                      <div className="flex gap-1.5">
                        {(["foot", "scooter", "vehicle"] as ZoneMode[]).map((m) => (
                          <button key={m} type="button" onClick={() => setNewMode(m)} className={newMode === m ? "rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground" : "rounded-md border border-border px-2 py-1"}>
                            {MODE_LABEL[m]}
                          </button>
                        ))}
                      </div>
                    )}
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is wrong, in a few words" className="h-7 w-full rounded-md border border-border bg-background px-2" />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="h-7" disabled={working} onClick={() => decide(z.id, "reject")}>
                        {working ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Send it back
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setFixing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {queue.length > 6 && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${queue.length} waiting`}
        </button>
      )}
    </div>
  );
}
