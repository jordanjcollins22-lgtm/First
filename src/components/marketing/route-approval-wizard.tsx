"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Printer, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RouteApprovalMap, type DrawTool } from "@/components/marketing/route-approval-map";
import {
  approveUspsRoute,
  backToDrawing,
  confirmDoorHangers,
  saveDoorHangerLine,
  skipUspsRoute,
  submitRouteOrder,
} from "@/lib/actions/route-approval-actions";
import { EMPTY_SHAPE, nextMonday, plusDays, routeName, STEP_LABEL, STEP_ORDER, stepQuestion, walkDoors, type WalkShape } from "@/lib/route-approval";
import type { RouteApprovalView } from "@/lib/data/route-approval";

/**
 * One route, one question.
 *
 * The map is the same through all four steps; only the question under it
 * changes. Approve the USPS route, draw the walk over it, confirm the
 * hangers, pick the days and submit. Each answer is saved before the next
 * question appears, so a phone put down half way picks up where it was.
 */
export function RouteApprovalWizard({ view }: { view: RouteApprovalView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  // The walk as drawn so far, starting from whatever was saved before.
  const savedShape = useMemo<WalkShape>(
    () => (view.round ? { area: view.round.area, line: view.round.line, parks: view.round.parks, start: view.round.start, end: view.round.end } : EMPTY_SHAPE),
    [view.round]
  );
  const [shape, setShape] = useState<WalkShape>(savedShape);
  const [tool, setTool] = useState<DrawTool>("area");
  const [resetKey, setResetKey] = useState(0);
  const [walkOn, setWalkOn] = useState(view.walkOn ?? nextMonday(new Date()));
  const [mailOn, setMailOn] = useState(view.mailOn ?? plusDays(nextMonday(new Date()), 7));

  const drawn = useMemo(() => walkDoors(view.houses, shape), [view.houses, shape]);
  const onRound = useMemo(() => new Set(view.step === "draw" ? drawn.order : (view.round?.order ?? view.round?.doorIds ?? [])), [view.step, drawn.order, view.round]);
  const anchorIds = useMemo(() => view.anchors.map((a) => a.houseId), [view.anchors]);
  const doors = view.step === "draw" ? drawn.order.length : (view.round?.order?.length || view.round?.doorIds.length || 0);
  const facts = { routeId: view.route.routeId, zip: view.route.zip, pieces: view.route.residential, doors };
  const stepIndex = STEP_ORDER.indexOf(view.step);

  function act(work: () => Promise<{ ok: boolean; message: string; orderId?: string }>, after?: (orderId?: string) => void) {
    setNote(null);
    start(async () => {
      const result = await work();
      setNote(result.message);
      if (result.ok) {
        after?.(result.orderId);
        router.refresh();
      }
    });
  }

  return (
    <section className="mb-6 rounded-2xl border border-white/60 bg-card/80 p-4 shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Step {stepIndex + 1} of {STEP_ORDER.length} · {STEP_LABEL[view.step]}
          </p>
          <h2 className="text-lg font-bold">{routeName(view.route)}</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {view.route.residential.toLocaleString()} homes · {view.houses.length.toLocaleString()} doors we know
          {view.route.facility ? ` · drops at ${view.route.facility}` : ""}
        </p>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Around{" "}
        {view.anchors.map((a, i) => (
          <span key={a.houseId}>
            {i > 0 ? (i === view.anchors.length - 1 ? " and " : ", ") : ""}
            <Link href={`/jobs/${a.jobId}`} className="underline">
              {a.customerName ?? a.address}
            </Link>
          </span>
        ))}
        . The red dots are the jobs we finished and were paid for
        {view.step === "hangers" || view.step === "submit" ? "; the orange ones are the doors on the round." : "."}
      </p>

      <div className="mt-3">
        <RouteApprovalMap
          rings={view.route.rings}
          paths={view.route.paths}
          houses={view.houses}
          anchorIds={anchorIds}
          onRound={onRound}
          drawing={view.step === "draw"}
          focus={view.step === "hangers" || view.step === "submit" ? "round" : "route"}
          tool={view.step === "draw" ? tool : null}
          shape={view.step === "draw" ? shape : savedShape}
          onShape={setShape}
          resetKey={resetKey}
        />
      </div>

      <p className="mt-4 text-base font-semibold">{stepQuestion(view.step, facts)}</p>

      {view.step === "usps" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" className="h-11" disabled={pending} onClick={() => act(() => approveUspsRoute({ eddmRouteId: view.route.id, houseIds: anchorIds }))}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Yes, approve this route
          </Button>
          <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => act(() => skipUspsRoute({ eddmRouteId: view.route.id, houseIds: anchorIds }))}>
            <X className="mr-2 h-4 w-4" />
            No, skip it
          </Button>
        </div>
      )}

      {view.step === "draw" && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["area", "Area"],
                ["park", "Park"],
                ["start", "Start"],
                ["end", "End"],
                ["line", "Walking line"],
              ] as [DrawTool, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTool(key)}
                className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${tool === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
              >
                {label}
                {key === "park" && shape.parks.length > 0 ? ` (${shape.parks.length})` : ""}
                {key === "area" && shape.area ? " ✓" : ""}
                {key === "start" && shape.start ? " ✓" : ""}
                {key === "end" && shape.end ? " ✓" : ""}
                {key === "line" && shape.line ? " ✓" : ""}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {tool === "area" && "Tap round the houses to hang; double tap to close the area. Every door inside it is on the round."}
            {tool === "park" && "Tap where the van parks. Tap again for another spot on a big round."}
            {tool === "start" && "Tap where the walk begins."}
            {tool === "end" && "Tap where the walk finishes."}
            {tool === "line" && "Tap along the streets the way you would walk them; double tap to finish. The doors are ordered along it, and the app learns the walk from it."}
            {!tool && "Pick a tool."}
            {drawn.order.length > 0 ? ` ${drawn.order.length} doors on the round so far.` : ""}
            {shape.area && drawn.order.length === 0 ? " No doors inside that area yet." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11"
              disabled={pending || drawn.order.length === 0 || !view.round}
              title={!shape.parks.length ? "Mark where the van parks before saving, if you can." : undefined}
              onClick={() =>
                view.round &&
                act(() =>
                  saveDoorHangerLine({
                    eddmRouteId: view.route.id,
                    playId: view.round!.id,
                    order: drawn.order,
                    shape,
                    otherPlayIds: view.anchors.map((a) => a.playId).filter((id): id is string => Boolean(id)),
                  })
                )
              }
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Save the door hanger route
            </Button>
            {shape !== savedShape && (
              <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => setResetKey((k) => k + 1)}>
                Clear the drawing
              </Button>
            )}
          </div>
          {shape.parks.length === 0 && drawn.order.length > 0 && (
            <p className="text-xs text-amber-700">No parking spot marked yet. The crew will want one.</p>
          )}
        </div>
      )}

      {view.step === "hangers" && view.round && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {doors} doors in walking order{view.sheets ? `, ${view.sheets} sheets through the printer` : ""}
            {view.round.assignedToName ? `, walked by ${view.round.assignedToName}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11" disabled={pending} onClick={() => act(() => confirmDoorHangers({ eddmRouteId: view.route.id, playId: view.round!.id }))}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Yes, these door hangers
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => act(() => backToDrawing({ eddmRouteId: view.route.id }))}>
              <Undo2 className="mr-2 h-4 w-4" />
              Draw it again
            </Button>
          </div>
        </div>
      )}

      {view.step === "submit" && (
        <div className="mt-2 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Walk the door hangers on</span>
              <input type="date" value={walkOn} onChange={(e) => setWalkOn(e.target.value)} className="h-11 rounded-lg border border-border bg-background px-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Mail the route on</span>
              <input type="date" value={mailOn} onChange={(e) => setMailOn(e.target.value)} className="h-11 rounded-lg border border-border bg-background px-3" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {view.mailing ? `${view.mailing.pieces.toLocaleString()} mailers` : "The mailing"}
            {doors ? ` and ${doors} door hangers${view.sheets ? ` on ${view.sheets} sheets` : ""}` : ""}. The order prints with the USPS package, the hanger count and the walking sheet.
          </p>
          <Button
            type="button"
            className="h-11 self-start"
            disabled={pending}
            onClick={() =>
              act(
                () => submitRouteOrder({ eddmRouteId: view.route.id, walkOn, mailOn }),
                (orderId) => {
                  if (orderId) router.push(`/my-day/route-orders/${orderId}`);
                }
              )
            }
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Submit and print the order
          </Button>
        </div>
      )}

      {note && <p className="mt-2 text-xs font-medium text-muted-foreground">{note}</p>}
    </section>
  );
}
