"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";

import { openEntity, runEntityAction } from "@/lib/actions/entity-actions";
import type { EntityAction, EntityRef, EntityView, ListRow } from "@/lib/entities/types";

/**
 * The drawer every list in the new layout opens into. Click a row and the
 * thing it names (a campaign, a client, a work day) opens on the right, or
 * from the bottom on a phone, with its details and what can be done to it.
 * Rows inside it open in turn; Back walks back through what was opened.
 */

type Open = (ref: EntityRef) => void;
const DrawerContext = createContext<Open | null>(null);

export function useOpenEntity(): Open | null {
  return useContext(DrawerContext);
}

export function EntityDrawerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<EntityRef[]>([]);
  const open = useCallback<Open>((ref) => setStack((s) => [...s, ref]), []);
  const current = stack[stack.length - 1];
  return (
    <DrawerContext.Provider value={open}>
      {children}
      {current && (
        <Drawer
          key={`${current.kind}:${current.id}:${stack.length}`}
          entity={current}
          canGoBack={stack.length > 1}
          onBack={() => setStack((s) => s.slice(0, -1))}
          onClose={() => setStack([])}
          onOpen={open}
        />
      )}
    </DrawerContext.Provider>
  );
}

/** A list row: a button that opens its thing when it has one, plain words when not. */
export function RowItem({ row, className }: { row: ListRow; className: string }) {
  const open = useOpenEntity();
  if (typeof row === "string" || !row.ref || !open) {
    return <li className={className}>{typeof row === "string" ? row : row.text}</li>;
  }
  const ref = row.ref;
  return (
    <li>
      <button
        type="button"
        onClick={() => open(ref)}
        className={className + " flex w-full items-center justify-between gap-2 text-left hover:bg-primary/10 hover:text-foreground"}
      >
        <span>{row.text}</span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function Drawer({
  entity,
  canGoBack,
  onBack,
  onClose,
  onOpen,
}: {
  entity: EntityRef;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpen: Open;
}) {
  const router = useRouter();
  const [view, setView] = useState<EntityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Each drawer is keyed by what it shows, so this runs once per thing opened.
  useEffect(() => {
    startTransition(async () => {
      const r = await openEntity(entity);
      if (r.ok) {
        setView(r.view);
        setError(null);
      } else setError(r.error);
    });
  }, [entity]);

  function run(action: EntityAction, value?: string) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const r = await runEntityAction(entity, action.id, value);
      if (r.ok) {
        setMessage(r.message ?? "Done.");
        router.refresh();
        const again = await openEntity(entity);
        // Gone (deleted, say): keep what it was, but nothing left to press.
        if (again.ok) setView(again.view);
        else setView((v) => (v ? { ...v, actions: [] } : v));
      } else setError(r.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/30" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={view?.title ?? "Details"}
        className="relative mt-auto flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-card shadow-2xl sm:mt-0 sm:h-full sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-2xl"
      >
        <header className="flex items-center gap-2 border-b px-3 py-2">
          {canGoBack && (
            <button type="button" onClick={onBack} aria-label="Back" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-muted">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{view?.title ?? "Loading…"}</p>
            {view?.subtitle && <p className="truncate text-xs text-muted-foreground">{view.subtitle}</p>}
          </div>
          {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button type="button" onClick={onClose} aria-label="Close" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">{error}</p>}
          {message && <p className="mb-3 rounded-lg bg-emerald-100 p-3 text-sm font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">{message}</p>}
          {!view && !error && <div className="h-32 animate-pulse rounded-xl bg-muted" />}
          {view && (
            <div className="grid gap-5">
              {view.status && (
                <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">{view.status}</span>
              )}
              {view.fields.length > 0 && (
                <dl className="grid gap-2 text-sm">
                  {view.fields.map((f) => (
                    <div key={f.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="break-words font-medium">{f.value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {view.actions.length > 0 && (
                <div className="grid gap-2">
                  {view.actions.map((a) => (
                    <ActionControl key={a.id} action={a} disabled={pending} onRun={run} />
                  ))}
                </div>
              )}
              {view.note && <p className="text-sm text-muted-foreground">{view.note}</p>}
              {view.sections?.map((s) => (
                <section key={s.title}>
                  <h3 className="mb-2 text-sm font-extrabold">{s.title}</h3>
                  {s.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{s.empty ?? "Nothing here yet."}</p>
                  ) : (
                    <ul className="grid gap-1.5 text-sm">
                      {s.rows.map((r, i) =>
                        r.ref ? (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => onOpen(r.ref!)}
                              className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-left hover:bg-primary/10"
                            >
                              <span>{r.text}</span>
                              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          </li>
                        ) : (
                          <li key={i} className="rounded-lg bg-muted px-3 py-2">
                            {r.text}
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ActionControl({ action, disabled, onRun }: { action: EntityAction; disabled: boolean; onRun: (a: EntityAction, v?: string) => void }) {
  const [value, setValue] = useState(action.input?.initial ?? "");
  const tone =
    action.tone === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : action.tone === "danger"
        ? "border border-destructive/40 text-destructive hover:bg-destructive/10"
        : "border hover:bg-muted";
  const button = (
    <button
      type="button"
      disabled={disabled || (action.input?.required && !value.trim())}
      onClick={() => onRun(action, action.input ? value : undefined)}
      className={"min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 " + tone}
    >
      {action.label}
    </button>
  );
  if (!action.input) return button;
  const i = action.input;
  const field = "min-h-11 w-full rounded-lg border bg-background px-3 text-sm";
  return (
    <div className="grid gap-1.5 rounded-xl border p-3">
      <label className="text-sm font-medium">{i.label}</label>
      {i.type === "select" ? (
        <select value={value} onChange={(e) => setValue(e.target.value)} className={field}>
          <option value="">Choose…</option>
          {i.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : i.type === "textarea" ? (
        <textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={i.placeholder} rows={3} className={field + " py-2"} />
      ) : (
        <input type={i.type} value={value} onChange={(e) => setValue(e.target.value)} placeholder={i.placeholder} className={field} />
      )}
      {button}
    </div>
  );
}
