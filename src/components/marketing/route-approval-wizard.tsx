"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Printer, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RouteApprovalMap } from "@/components/marketing/route-approval-map";
import {
  approveUspsRoute,
  backToDrawing,
  confirmDoorHangers,
  saveDoorHangerLine,
  skipUspsRoute,
  submitRouteOrder,
} from "@/lib/actions/route-approval-actions";
import { doorsAlongLines, nextMonday, plusDays, routeName, STEP_LABEL, STEP_ORDER, stepQuestion } from "@/lib/route-approval";
import type { RouteApprovalView } from "@/lib/data/route-approval";
import type { Point } from "@/lib/route-order";

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
  const [lines, setLines] = useState<Point[][]>([]);
  const [walkOn, setWalkOn] = useState(view.walkOn ?? nextMonday(new Date()));
  const [mailOn, setMailOn] = useState(view.mailOn ?? plusDays(nextMonday(new Date()), 7));

  const drawn = useMemo(() => doorsAlongLines(view.houses, lines), [view.houses, lines]);
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
        . The red dots are the jobs we finished and were paid for.
      </p>

      <div className="mt-3">
        <RouteApprovalMap
          rings={view.route.rings}
          paths={view.route.paths}
          houses={view.houses}
          anchorIds={anchorIds}
          onRound={onRound}
          drawing={view.step === "draw"}
          initialLine={view.round?.line ?? null}
          savedLine={view.round?.line ?? null}
          onLines={setLines}
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
          <p className="text-xs text-muted-foreground">
            Use the line tool at the top left of the map. Tap along the streets, double tap to finish a line, draw another for a second street. Doors within reach turn orange.
            {drawn.order.length > 0 ? ` ${drawn.order.length} doors on the line so far.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11"
              disabled={pending || drawn.order.length === 0 || !view.round}
              onClick={() =>
                view.round &&
                act(() =>
                  saveDoorHangerLine({
                    eddmRouteId: view.route.id,
                    playId: view.round!.id,
                    order: drawn.order,
                    line: drawn.line,
                    otherPlayIds: view.anchors.map((a) => a.playId).filter((id): id is string => Boolean(id)),
                  })
                )
              }
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Save the door hanger route
            </Button>
          </div>
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
