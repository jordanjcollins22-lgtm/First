import { Eye, HelpCircle, MousePointerClick } from "lucide-react";

import { describeSeconds, type AttentionSummary, type Sitting } from "@/lib/proposal-attention";
import type { TappedQuestion } from "@/lib/data/proposal-attention";
import { monthDayTime } from "@/lib/time-zone";

/**
 * What the client read, and when.
 *
 * The view count already says a proposal was opened four times. This says what
 * happened inside those four opens, which is the part somebody can pick up a
 * phone about. Ninety seconds on the price and four on the scope is a price
 * objection. Three readings of the fence area and nothing on the total is a
 * question about the fence. Those are different calls.
 *
 * The sittings are listed with real clock times rather than "2 hours ago",
 * because the question being answered here is often "when did they look at it"
 * in the literal sense, and a relative time cannot answer that.
 *
 * Internal only. Nothing on this panel is visible on the client's own page,
 * and nothing behind it identifies anybody: the visitor hash is salted with
 * the proposal's id, so two people in a household can be told apart on this
 * quote and neither can be followed to another.
 */
export function AttentionPanel({
  summary,
  sittings,
  questions = [],
}: {
  summary: AttentionSummary;
  sittings: Sitting[];
  /** The stock questions they tapped, with what came of each. */
  questions?: TappedQuestion[];
}) {
  const readQuestions = summary.read.find((line) => line.target === "questions");
  if (summary.read.length === 0 && summary.clicks.length === 0 && questions.length === 0) {
    return (
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h3 className="font-semibold">What they read</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing recorded yet. This fills in the first time the client opens the proposal and
          stays on it long enough to be reading rather than scrolling past.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">What they read</h3>
        <span className="text-xs text-muted-foreground">
          {describeSeconds(summary.totalSeconds)} in total
        </span>
      </div>

      {summary.thin ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Opened, but barely read. Not enough here to say which part they were interested in.
        </p>
      ) : (
        summary.focus && (
          <p className="mt-1 text-xs text-muted-foreground">
            Most time on <span className="font-medium">{summary.focus.label.toLowerCase()}</span>,
            which is where to start the call.
          </p>
        )
      )}

      {summary.read.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {summary.read.map((line) => (
            <li key={line.target}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">{line.label}</span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {describeSeconds(line.seconds)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(line.share * 100)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
                  {line.times} time{line.times === 1 ? "" : "s"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {summary.clicks.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <MousePointerClick className="h-3.5 w-3.5" />
            What they pressed
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {summary.clicks.map((line) => (
              <li key={`${line.target}-${line.label}`} className="flex justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  {ACTION_LABEL[line.target] ?? line.target}
                  {line.label && <span className="ml-1 font-medium text-foreground">{line.label}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">×{line.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reading the questions and tapping one are different things, and
          the office needs to know which. A tap is listed with its time and
          what came of it; time on the section with no tap is said outright. */}
      {(questions.length > 0 || readQuestions) && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <HelpCircle className="h-3.5 w-3.5" />
            Common questions
          </p>
          {questions.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Spent {describeSeconds(readQuestions!.seconds)} on the questions but tapped none of them.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {questions.map((q) => (
                <li key={`${q.at}-${q.label}`} className="text-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium tabular-nums">{when(q.at)}</span>
                    <span className="font-medium">Tapped “{q.label}”</span>
                  </div>
                  <p className="text-muted-foreground">{q.outcome}</p>
                  {q.note && <p className="mt-0.5 rounded-md border border-border bg-background/70 px-2 py-1 italic">“{q.note}”</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sittings.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Eye className="h-3.5 w-3.5" />
            Every time they sat with it
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {sittings.map((sitting) => (
              <li
                key={`${sitting.startedAt}-${sitting.visitorHash ?? "?"}`}
                className="flex flex-wrap items-baseline gap-x-2 text-xs"
              >
                <span className="font-medium tabular-nums">{when(sitting.startedAt)}</span>
                <span className="text-muted-foreground">
                  {describeSeconds(sitting.seconds)}
                  {sitting.clicks > 0 &&
                    `, ${sitting.clicks} tap${sitting.clicks === 1 ? "" : "s"}`}
                </span>
                {sitting.focus && (
                  <span className="truncate text-muted-foreground">on {sitting.focus.toLowerCase()}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** What a recorded press was, in words somebody in the office would use. */
const ACTION_LABEL: Record<string, string> = {
  "ask-about-area": "Asked about",
  "sent-message": "Sent a message about",
  accept: "Accepted",
  decline: "Declined",
  "decline-opened": "Opened the decline box",
};

/** A real clock time, because "2 hours ago" cannot answer "when did they look". */
function when(iso: string): string {
  // On the business clock. The server runs on UTC, and "6:41 PM" for a
  // page opened at 2:41 in Bel Air is the wrong answer to "when did they look".
  return monthDayTime(iso);
}
