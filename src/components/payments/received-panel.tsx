"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, FolderPlus, Link2, Search, Unlink, UserPlus } from "lucide-react";

import type { ReceivedGroup, ReceivedPaymentsData } from "@/lib/data/received-payments";
import {
  attachPaymentsToProject,
  createProjectForPayments,
  detachPayments,
  linkPaymentsToCustomer,
  unlinkPaymentsFromCustomer,
  searchContacts,
} from "@/lib/actions/received-payment-actions";
import { isConfident, type SearchableContact } from "@/lib/payer-match";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Why a group is a group, in words the office can check against reality. */
const REASON: Record<ReceivedGroup["reason"], string> = {
  job: "On a project",
  invoice: "One invoice",
  window: "Close together",
  unmatched: "No contact",
};

export function ReceivedPanel({ data }: { data: ReceivedPaymentsData }) {
  const [filter, setFilter] = useState<"needs" | "all">("needs");

  const shown = useMemo(
    () => (filter === "all" ? data.groups : data.groups.filter((g) => !g.jobId)),
    [data.groups, filter]
  );

  const { summary } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Received" value={money(summary.totalCents)} />
        <Tile label="On a project" value={money(summary.linkedCents)} />
        <Tile
          label="Needs a project"
          value={money(summary.unlinkedCents)}
          tone={summary.unlinkedCents > 0 ? "warn" : undefined}
        />
        <Tile
          label="No contact"
          value={money(summary.unmatchedCents)}
          tone={summary.unmatchedCents > 0 ? "warn" : undefined}
        />
      </div>

      {data.undocumented.length > 0 && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-4 w-4" />
            {data.undocumented.length} paid us with nothing documented
          </p>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
            These contacts have money against them and no project at all:{" "}
            {data.undocumented
              .slice(0, 6)
              .map((u) => `${u.customerName} (${money(u.totalCents)})`)
              .join(", ")}
            {data.undocumented.length > 6 ? `, and ${data.undocumented.length - 6} more.` : "."}
          </p>
        </div>
      )}

      <div className="flex gap-1.5">
        <FilterButton active={filter === "needs"} onClick={() => setFilter("needs")}>
          Needs a project ({summary.needingProject})
        </FilterButton>
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
          All ({summary.groups})
        </FilterButton>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
          {filter === "needs"
            ? "Every payment is filed against a project."
            : "No payments recorded yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((group) => (
            <GroupCard key={group.key} group={group} data={data} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`text-lg font-bold ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
        active ? "bg-foreground text-background" : "border border-border bg-card/60"
      }`}
    >
      {children}
    </button>
  );
}

function GroupCard({ group, data }: { group: ReceivedGroup; data: ReceivedPaymentsData }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(group.suggestedName);
  const [address, setAddress] = useState("");

  const options = group.customerId ? data.projectsByCustomer[group.customerId] ?? [] : [];
  const needsAddress = Boolean(group.customerId && data.needAddress.includes(group.customerId));

  function run(fn: () => Promise<{ ok: true; jobId: string } | { ok: false; message: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok) setDone(true);
      else setError(result.message);
    });
  }

  if (done) {
    return (
      <li className="rounded-lg border border-emerald-300/70 bg-emerald-50/70 px-3 py-2 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <span className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
          <Check className="h-4 w-4" /> Filed. Refresh to see it in place.
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {group.customerName ?? group.payerName ?? "Unmatched payment"}
          </p>
          <p className="text-xs text-muted-foreground">
            {group.payments.length} payment{group.payments.length === 1 ? "" : "s"} ·{" "}
            {day(group.firstAt)}
            {group.firstAt !== group.lastAt ? ` – ${day(group.lastAt)}` : ""} ·{" "}
            <span className="whitespace-nowrap rounded bg-muted px-1 py-px">
              {REASON[group.reason]}
            </span>
          </p>
        </div>
        <p className="shrink-0 text-base font-bold">{money(group.totalCents)}</p>
      </div>

      <ul className="mt-2 space-y-0.5 border-l-2 border-border pl-2">
        {group.payments.map((p) => (
          <li key={p.id} className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              {day(p.receivedAt)} · {p.method}
              {p.note ? ` · ${p.note}` : ""}
            </span>
            <span className="shrink-0 tabular-nums">{money(p.amountCents)}</span>
          </li>
        ))}
      </ul>

      {group.jobId ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Link2 className="mr-1 inline h-3.5 w-3.5" />
            {group.jobName ?? "On a project"}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => detachPayments(group.paymentIds))}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold disabled:opacity-50"
          >
            <Unlink className="h-3.5 w-3.5" /> Unfile
          </button>
        </div>
      ) : !group.customerId ? (
        <LinkToContact group={group} onLinked={() => setDone(true)} />
      ) : creating ? (
        <div className="mt-2 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          {needsAddress && (
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Property address (this contact has none on file)"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  createProjectForPayments({
                    customerId: group.customerId!,
                    name,
                    paymentIds: group.paymentIds,
                    address: needsAddress ? address : null,
                  })
                )
              }
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create project"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {options.length > 0 && (
            <select
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                if (e.target.value) run(() => attachPaymentsToProject(group.paymentIds, e.target.value));
              }}
              className="max-w-[60%] rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">File on an existing project…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.status})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5" /> New project
          </button>
          {/* The way back out. Linking money to a contact is now one tap, so
              the wrong tap has to be one tap to undo. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unlinkPaymentsFromCustomer(group.paymentIds))}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Not this contact
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </li>
  );
}

/**
 * Saying whose money this is.
 *
 * This used to be a sentence explaining that nothing could be done here. The
 * payment carries the name and email it arrived with, and the contact book is
 * searchable, so the two can be put together in one tap rather than in
 * another system.
 *
 * The suggestions come down with the page already scored, so the common case
 * — the payer's email is somebody we know — costs no round trip at all. The
 * search box is for the rest.
 */
function LinkToContact({ group, onLinked }: { group: ReceivedGroup; onLinked: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The results, and the term they are the answer to. Kept together so
  // "still searching" is read off the two rather than tracked as a third
  // piece of state that can disagree with them.
  const [results, setResults] = useState<{ term: string; contacts: SearchableContact[] }>({
    term: "",
    contacts: [],
  });

  const term = query.trim();
  const answered = results.term === term;
  const searching = term.length >= 2 && !answered;

  // Debounced: a request per keystroke is three requests for "joe", and only
  // the last one is an answer anybody reads.
  useEffect(() => {
    if (term.length < 2) return;

    let live = true;
    const timer = setTimeout(async () => {
      const found = await searchContacts(term);
      if (!live) return;
      if (found.ok) setResults({ term, contacts: found.contacts });
      else setError(found.message);
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  function link(customerId: string) {
    setError(null);
    start(async () => {
      const result = await linkPaymentsToCustomer(group.paymentIds, customerId);
      if (result.ok) onLinked();
      else setError(result.message);
    });
  }

  // The name is already the heading when there is one, so it is not repeated.
  const said = [group.payerEmail, group.payerPhone].filter(Boolean);
  // Anybody already offered above should not appear again underneath.
  const suggestedIds = new Set(group.suggestions.map((s) => s.id));
  const extra = answered ? results.contacts.filter((r) => !suggestedIds.has(r.id)) : [];

  return (
    <div className="mt-2 space-y-2">
      {said.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          The payment came in with{" "}
          <span className="font-medium text-foreground">{said.join(" · ")}</span>
        </p>
      ) : group.payerName ? null : (
        <p className="text-xs text-muted-foreground">
          This payment arrived with no name or email on it. Search for whoever it belongs to.
        </p>
      )}

      {group.suggestions.length > 0 && (
        <ul className="space-y-1">
          {group.suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => link(s.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-semibold disabled:opacity-50 ${
                  isConfident(s)
                    ? "border-emerald-300/70 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                    : "border-border"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{s.name ?? "Unnamed contact"}</span>
                  <span className="block truncate text-[11px] font-normal text-muted-foreground">
                    {s.reason}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <UserPlus className="h-3.5 w-3.5" /> Link
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={group.suggestions.length > 0 ? "Or search for someone else…" : "Search contacts by name, email or phone"}
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm"
        />
      </div>

      {searching && <p className="text-xs text-muted-foreground">Searching…</p>}

      {!searching && term.length >= 2 && extra.length === 0 && (
        <p className="text-xs text-muted-foreground">Nobody matching &ldquo;{term}&rdquo;.</p>
      )}

      {extra.length > 0 && (
        <ul className="space-y-1">
          {extra.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => link(r.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs font-semibold disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate">{r.name ?? "Unnamed contact"}</span>
                  <span className="block truncate text-[11px] font-normal text-muted-foreground">
                    {[r.email, r.phone].filter(Boolean).join(" · ") || "No email or phone on file"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <UserPlus className="h-3.5 w-3.5" /> Link
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
