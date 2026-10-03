import Link from "next/link";
import { ArrowDown, ChevronRight, Mail, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { STATUS_LABEL, SYSTEM_FLOW, type SystemSquare, type SystemStatus } from "@/lib/system-flow";
import { getClientMessageSequence } from "@/lib/data/client-message-sequence";
import type { SequenceMessage } from "@/lib/client-message-sequence";

const DOT: Record<SystemStatus, string> = {
  live: "bg-emerald-500",
  partly: "bg-amber-500",
  "not-built": "bg-muted-foreground/40",
};

/**
 * Every system, one small square each, in the order a customer meets them.
 * A square opens where that system is run; one that is not built yet says so
 * and opens nothing. Under each step, the emails and texts the client gets
 * at it, numbered to the step (1.1, 1.2), each opening the message itself.
 */
export async function SystemFlow() {
  const { messages } = await getClientMessageSequence().catch(() => ({ messages: [] as SequenceMessage[] }));
  return <SystemFlowView messages={messages} />;
}

/** The squares, with each step's automations under it. */
export function SystemFlowView({ messages }: { messages: SequenceMessage[] }) {
  let step = 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Tap a square to open it.</p>
      {SYSTEM_FLOW.map((stage, i) => (
        <section key={stage.key} className="flex flex-col gap-2">
          {i > 0 && <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden />}
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.title}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stage.squares.map((square) => {
              // Marketing runs side by side; everything after it is one line, numbered.
              const number = stage.key === "marketing" ? null : ++step;
              return (
                <li key={square.key}>
                  <Square square={square} number={number} automations={messages.filter((m) => m.square === square.key)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <Legend />
      <p className="text-[11px] text-muted-foreground">
        Under a step, its automations: the emails and texts the client gets at it, numbered to the step, text before email. A green dot is
        on. Tap one to see it as the client gets it.
      </p>
    </div>
  );
}

function Square({ square, number, automations }: { square: SystemSquare; number: number | null; automations: SequenceMessage[] }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        {number != null ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {number}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", DOT[square.status])} aria-hidden />
          {STATUS_LABEL[square.status]}
        </span>
      </span>
      <span className="mt-1.5 flex items-start justify-between gap-1 text-sm font-semibold leading-snug">
        {square.title}
        {square.href && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      </span>
      <span className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted-foreground">{square.line}</span>
      {square.gap && <span className="mt-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-400">{square.gap}</span>}
    </>
  );
  const box = cn(
    "flex flex-col rounded-xl border p-2.5",
    square.status === "not-built" ? "border-dashed border-border bg-transparent" : "border-border bg-card",
    square.href && "transition-colors hover:border-primary/50 hover:bg-accent/40"
  );
  const main = square.href ? (
    <Link href={square.href} className={cn(box, "min-h-[7.5rem] flex-1")} title={square.line}>
      {body}
    </Link>
  ) : (
    <div className={cn(box, "min-h-[7.5rem] flex-1")} title={square.line}>
      {body}
    </div>
  );
  if (automations.length === 0) return <div className="flex h-full flex-col">{main}</div>;
  return (
    <div className="flex h-full flex-col gap-1">
      {main}
      {/* The automations at this step, in order: each opens the message as the client gets it. */}
      <ol className="flex flex-col gap-0.5 rounded-xl border border-border bg-card/60 p-1.5">
        <li className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Automations</li>
        {automations.map((m) => (
          <li key={m.key}>
            <Link
              href={`/practice/messages?step=${m.square}#${m.key}`}
              className={cn("flex items-start gap-1.5 rounded-md px-1 py-0.5 text-[11px] leading-snug hover:bg-accent/60", !m.on && "text-muted-foreground")}
              title={`${m.when}. ${m.on ? "On" : m.note ?? "Switched off"}`}
            >
              <span className="w-7 shrink-0 font-semibold tabular-nums">{m.number}</span>
              {m.channel === "sms" ? <MessageSquare className="h-3 w-3 shrink-0" aria-hidden /> : <Mail className="h-3 w-3 shrink-0" aria-hidden />}
              <span className="line-clamp-2 min-w-0 flex-1">
                {m.channel === "sms" ? "Text" : "Email"} · {m.moment}
              </span>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m.on ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-label={m.on ? "On" : "Off"} />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Legend() {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {(Object.keys(STATUS_LABEL) as SystemStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", DOT[s])} aria-hidden />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </p>
  );
}
