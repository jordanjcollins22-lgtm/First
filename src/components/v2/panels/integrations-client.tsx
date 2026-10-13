"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { disconnectIntegrationAction, saveIntegrationAction, testIntegrationAction } from "@/lib/actions/integration-actions";

/** One provider as the page may see it: no secret values, ever. */
export interface ProviderView {
  id: string;
  name: string;
  area: string;
  enables: string;
  howTo: string[];
  docsUrl: string | null;
  oauthStartPath: string | null;
  redirectUri: string | null;
  hasTest: boolean;
  fields: { key: string; label: string; secret: boolean; placeholder: string; help: string; value: string; saved: boolean }[];
  status: "not_connected" | "connected" | "error";
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  everSaved: boolean;
}

const BADGE: Record<ProviderView["status"], { text: string; cls: string }> = {
  connected: { text: "Connected", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" },
  error: { text: "Not working", cls: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100" },
  not_connected: { text: "Not connected", cls: "bg-muted text-muted-foreground" },
};

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Says how a Connect round-trip went, from the query the callback sent the owner back with. */
export function OAuthReturnNotice({ names }: { names: Record<string, string> }) {
  const params = useSearchParams();
  const id = params.get("integration");
  if (!id) return null;
  const name = names[id] ?? id;
  const error = params.get("error");
  if (error)
    return (
      <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
        {name}: {error}
      </p>
    );
  if (params.get("connected"))
    return (
      <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
        {name} is connected.
      </p>
    );
  return null;
}

export function IntegrationCard({ provider: p }: { provider: ProviderView }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(p.fields.map((f) => [f.key, f.value])));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(p.status === "error");

  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) after?.();
      router.refresh();
    });

  const save = () =>
    run(
      () => saveIntegrationAction(p.id, values),
      // Secret boxes empty again: what was typed is saved and never comes back.
      () => setValues((v) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, p.fields.find((f) => f.key === k)?.secret ? "" : val])))
    );

  const badge = BADGE[p.status];
  return (
    <section className="rounded-xl border bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-start gap-3 p-4 text-left hover:bg-muted/50">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.text}</span>
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{p.enables}</span>
          {p.lastError && p.status !== "connected" && <span className="mt-1 block text-sm text-red-700 dark:text-red-300">{p.lastError}</span>}
        </span>
        <span aria-hidden className="text-muted-foreground">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 pb-4 pt-3">
          <details className="rounded-lg bg-muted/60 p-3 text-sm" open={!p.everSaved}>
            <summary className="cursor-pointer font-medium">How to get this</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              {p.howTo.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            {p.redirectUri && (
              <p className="mt-2 text-xs">
                Redirect URI to register: <code className="break-all rounded bg-background px-1 py-0.5">{p.redirectUri}</code>
              </p>
            )}
            {p.docsUrl && (
              <a href={p.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
                Provider&apos;s instructions
              </a>
            )}
          </details>

          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {p.fields.map((f) => (
              <label key={f.key} className="grid gap-1 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  {f.label}
                  {f.secret && f.saved && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">saved</span>}
                </span>
                <Input
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  className="min-h-11"
                  value={values[f.key] ?? ""}
                  placeholder={f.secret && f.saved ? "•••••••• (leave blank to keep)" : f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
                {f.help && <span className="text-xs text-muted-foreground">{f.help}</span>}
              </label>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" className="min-h-11" disabled={pending}>
                Save
              </Button>
              {p.oauthStartPath && (
                <Button asChild variant="secondary" className="min-h-11">
                  <a href={p.oauthStartPath}>{p.status === "connected" ? "Reconnect" : "Connect"}</a>
                </Button>
              )}
              {p.hasTest && (
                <Button type="button" variant="secondary" className="min-h-11" disabled={pending || !p.everSaved} onClick={() => run(() => testIntegrationAction(p.id))}>
                  Test
                </Button>
              )}
              {p.everSaved && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-red-700 dark:text-red-300"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Disconnect ${p.name}? Everything saved for it is deleted.`)) run(() => disconnectIntegrationAction(p.id));
                  }}
                >
                  Disconnect
                </Button>
              )}
            </div>
          </form>

          {message && (
            <p role="status" className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
              {message.text}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {p.connectedAt ? `Connected ${when(p.connectedAt)}. ` : ""}Last checked {when(p.lastCheckedAt)}.
          </p>
        </div>
      )}
    </section>
  );
}
