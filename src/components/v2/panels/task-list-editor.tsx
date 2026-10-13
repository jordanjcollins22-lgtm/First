"use client";

import { useState, useTransition } from "react";

import { addOwnerTask, setOwnerTaskStatus } from "@/lib/actions/owner-task-actions";
import {
  TASK_SECTIONS,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  toggledStatus,
  type TaskRow,
  type TaskStatus,
} from "@/lib/owner-tasks";
import { OpenButton } from "@/components/v2/panels/admin-open";

const STATUS_CLS: Record<TaskStatus, string> = {
  todo: "bg-muted text-foreground",
  not_built: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  partly_built: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  in_progress: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  done: "bg-muted text-muted-foreground",
  dropped: "bg-muted text-muted-foreground",
};

/**
 * The list itself: tick, change status, add. Changes show at once and are
 * put back if the save fails, so a bad signal never leaves a tick that
 * nobody else can see.
 */
export function TaskListEditor({ tasks }: { tasks: TaskRow[] }) {
  const [rows, setRows] = useState(tasks);
  // What a task was before it was ticked, so un-ticking puts it back.
  const [before, setBefore] = useState<Record<string, TaskStatus>>({});
  const [note, setNote] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<string>("Other");
  const [pending, start] = useTransition();

  function setStatus(task: TaskRow, status: TaskStatus) {
    const previous = task.status;
    setRows((all) => all.map((t) => (t.id === task.id ? { ...t, status } : t)));
    if (status === "done") setBefore((b) => ({ ...b, [task.id]: previous }));
    start(async () => {
      const result = await setOwnerTaskStatus(task.id, status);
      if (!result.ok) {
        setRows((all) => all.map((t) => (t.id === task.id ? { ...t, status: previous } : t)));
        setNote(result.message);
      }
    });
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    start(async () => {
      const result = await addOwnerTask({ title: name, section });
      setNote(result.message);
      if (result.ok && result.id) {
        setRows((all) => [
          ...all,
          { id: result.id!, section, title: name, note: null, status: "todo", position: 9999, doneAt: null, updatedAt: new Date().toISOString() },
        ]);
        setTitle("");
      }
    });
  }

  const sections = [...new Set([...TASK_SECTIONS, ...rows.map((r) => r.section)])].filter((s) => rows.some((r) => r.section === s));

  return (
    <div className="grid gap-5">
      <form onSubmit={add} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <label className="sr-only" htmlFor="new-task">New task</label>
        <input
          id="new-task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          maxLength={200}
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        />
        <label className="sr-only" htmlFor="new-task-section">Section</label>
        <select
          id="new-task-section"
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="min-h-11 rounded-lg border bg-background px-2 text-sm"
        >
          {TASK_SECTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="submit" disabled={pending || !title.trim()} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Add
        </button>
      </form>
      {note && <p className="text-sm text-muted-foreground" role="status">{note}</p>}

      {sections.map((s) => {
        const items = rows.filter((r) => r.section === s);
        return (
          <div key={s}>
            <h3 className="mb-2 text-base font-extrabold">
              {s} <span className="font-mono text-xs font-normal text-muted-foreground">{items.length}</span>
            </h3>
            <ul className="grid gap-2">
              {items.map((t) => {
                const done = t.status === "done";
                const dropped = t.status === "dropped";
                return (
                  <li key={t.id} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                    <input
                      id={`task-${t.id}`}
                      type="checkbox"
                      checked={done}
                      onChange={() => setStatus(t, toggledStatus(t.status, before[t.id] ?? null))}
                      className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
                    />
                    <label htmlFor={`task-${t.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className={"font-bold " + (done || dropped ? "text-muted-foreground line-through" : "")}>{t.title}</span>
                      {t.note && <span className="mt-0.5 block text-sm text-muted-foreground">{t.note}</span>}
                    </label>
                    <label className="sr-only" htmlFor={`status-${t.id}`}>Status</label>
                    <select
                      id={`status-${t.id}`}
                      value={t.status}
                      onChange={(e) => setStatus(t, e.target.value as TaskStatus)}
                      className={"min-h-11 shrink-0 rounded-full px-2 font-mono text-[11px] " + STATUS_CLS[t.status]}
                    >
                      {TASK_STATUSES.map((st) => (
                        <option key={st} value={st}>{TASK_STATUS_LABEL[st]}</option>
                      ))}
                    </select>
                    <OpenButton kind="admin.owner_task" id={t.id} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
