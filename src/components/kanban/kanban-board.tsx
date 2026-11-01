"use client";

import { useState, useTransition, type DragEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsUp,
  Clock,
  MessageSquare,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createCard,
  deleteCard,
  moveCard,
  reorderCard,
  updateCard,
  updateWipLimits,
  type ActionResult,
} from "@/lib/actions/kanban-actions";
import type { KanbanCard } from "@/lib/data/kanban";
import {
  COLUMNS,
  countByColumn,
  nextStage,
  previousStage,
  type Department,
  type Stage,
  type WipLimits,
} from "@/lib/kanban/board";
import { cn } from "@/lib/utils";

interface Props {
  department: Department;
  cards: KanbanCard[];
  limits: WipLimits;
}

export function KanbanBoard({ department, cards, limits }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Stage | null>(null);

  const counts = countByColumn(cards.filter((c) => c.stage !== "validate_done").map((c) => c.stage));
  const byStage = (stage: Stage) => cards.filter((c) => c.stage === stage);

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  function onDrop(e: DragEvent, stage: Stage) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/kanban-card");
    const card = cards.find((c) => c.id === id);
    if (card && card.stage !== stage) run(() => moveCard(id, stage));
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{error}</span>
          <button type="button" className="font-medium underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className={cn("flex gap-3 overflow-x-auto pb-2", isPending && "opacity-70")}>
        {COLUMNS.map((col) => {
          const limit = col.key === "backlog" ? null : limits[col.key];
          const count = col.key === "backlog" ? byStage("backlog").length : counts[col.key];
          const full = limit !== null && count >= limit;
          return (
            <section
              key={col.key}
              // Each sub-column gets an equal share of the width, never narrower than 10rem.
              style={{ flex: `${col.stages.length} 1 0`, minWidth: `${col.stages.length * 10}rem` }}
              className={cn(
                "flex flex-col rounded-xl border bg-card",
                full ? "border-amber-500" : "border-border"
              )}
            >
              <header className="border-b border-border px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{col.label}</h2>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      full ? "text-amber-700" : "text-muted-foreground"
                    )}
                    title={limit !== null ? "Cards in this column / WIP limit" : undefined}
                  >
                    {limit !== null ? `${count} / ${limit}` : `${count}`}
                  </span>
                </div>
                {col.doneRule && <p className="text-xs text-muted-foreground">Done when: {col.doneRule}</p>}
                {col.key === "backlog" && (
                  <p className="text-xs text-muted-foreground">Top card is the priority.</p>
                )}
              </header>

              <div className="flex flex-1 divide-x divide-border">
                {col.stages.map(({ stage, label }) => (
                  <div
                    key={stage}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(stage);
                    }}
                    onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
                    onDrop={(e) => onDrop(e, stage)}
                    className={cn(
                      "flex min-h-64 min-w-0 flex-1 flex-col gap-2 p-2",
                      dragOver === stage && "bg-accent/60",
                      stage === "answer_track" && "bg-amber-50/60"
                    )}
                  >
                    {col.stages.length > 1 && (
                      <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {label}
                        {stage === "answer_track" && (
                          <span className="block normal-case tracking-normal">Waiting on someone outside</span>
                        )}
                      </p>
                    )}
                    {stage === "backlog" && (
                      <AddCardForm onSubmit={(fd) => run(() => createCard(department, fd))} />
                    )}
                    {byStage(stage).map((card, i, list) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        isFirst={i === 0}
                        isLast={i === list.length - 1}
                        run={run}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <WipLimitsForm
        limits={limits}
        onSubmit={(fd) => run(() => updateWipLimits(department, fd))}
      />
    </div>
  );
}

function AddCardForm({ onSubmit }: { onSubmit: (fd: FormData) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add a card
      </Button>
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    onSubmit(new FormData(form));
    form.reset();
    setOpen(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border p-2">
      <Input name="title" placeholder="Question or task" required autoFocus />
      <Input name="asked_by" placeholder="Who asked? (optional)" />
      <Textarea name="details" placeholder="Details (optional)" rows={2} />
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Add to Backlog
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CardItem({
  card,
  isFirst,
  isLast,
  run,
}: {
  card: KanbanCard;
  isFirst: boolean;
  isLast: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const next = nextStage(card.stage);
  const prev = previousStage(card.stage);

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(() => updateCard(card.id, fd));
          setEditing(false);
        }}
        className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2"
      >
        <Input name="title" defaultValue={card.title} required autoFocus />
        <Input name="asked_by" defaultValue={card.asked_by ?? ""} placeholder="Who asked?" />
        <Textarea name="details" defaultValue={card.details ?? ""} placeholder="Details" rows={3} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {/* A job's card comes back while the job is open, so it is not deleted here. */}
          {card.source !== "job" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => {
              if (confirm("Delete this card?")) run(() => deleteCard(card.id));
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/kanban-card", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-background p-2 text-sm shadow-sm active:cursor-grabbing",
        isFirst && card.stage !== "validate_done" && "border-l-4 border-l-primary"
      )}
    >
      {card.job_id ? (
        <Link href={`/jobs/${card.job_id}`} className="font-medium break-words hover:text-primary hover:underline">
          {card.title}
        </Link>
      ) : (
        <p className="font-medium break-words">{card.title}</p>
      )}
      {(card.asked_by || card.source === "ghl") && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {card.source === "ghl" && <MessageSquare className="h-3 w-3" aria-label="From GoHighLevel" />}
          {card.asked_by && <span>{card.source === "job" ? "Client: " : "Asked by "}{card.asked_by}</span>}
        </p>
      )}
      {card.details && (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{card.details}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-0.5">
        <IconButton title="Move to top" disabled={isFirst} onClick={() => run(() => reorderCard(card.id, "top"))}>
          <ChevronsUp className="h-4 w-4" />
        </IconButton>
        <IconButton title="Move up" disabled={isFirst} onClick={() => run(() => reorderCard(card.id, "up"))}>
          <ArrowUp className="h-4 w-4" />
        </IconButton>
        <IconButton title="Move down" disabled={isLast} onClick={() => run(() => reorderCard(card.id, "down"))}>
          <ArrowDown className="h-4 w-4" />
        </IconButton>
        <IconButton title="Edit" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
        </IconButton>
        <span className="ml-auto flex gap-0.5">
          {prev && (
            <IconButton title="Move back" onClick={() => run(() => moveCard(card.id, prev))}>
              <ArrowLeft className="h-4 w-4" />
            </IconButton>
          )}
          {card.stage === "answer" && (
            <IconButton
              title="Waiting on an outside source (Track)"
              onClick={() => run(() => moveCard(card.id, "answer_track"))}
            >
              <Clock className="h-4 w-4" />
            </IconButton>
          )}
          {card.stage === "answer_track" && (
            <IconButton title="Back to working on it" onClick={() => run(() => moveCard(card.id, "answer"))}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
          )}
          {next && (
            <IconButton title="Move forward" onClick={() => run(() => moveCard(card.id, next))}>
              <ArrowRight className="h-4 w-4" />
            </IconButton>
          )}
        </span>
      </div>
    </article>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function WipLimitsForm({ limits, onSubmit }: { limits: WipLimits; onSubmit: (fd: FormData) => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 text-sm"
    >
      <div className="basis-full">
        <p className="font-semibold">WIP limits</p>
        <p className="text-xs text-muted-foreground">
          The most cards each column can hold at once, counting its Done (and Track) cards. A full column has to
          pass a card on before it can pull a new one in. Start here and lower a limit if cards pile up.
        </p>
      </div>
      {(["breakdown", "answer", "validate"] as const).map((key) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs font-medium capitalize">{key}</span>
          <Input
            name={key}
            type="number"
            min={1}
            max={50}
            defaultValue={limits[key]}
            key={limits[key]}
            className="w-20"
          />
        </label>
      ))}
      <Button type="submit" size="sm" variant="outline">
        Save limits
      </Button>
    </form>
  );
}
