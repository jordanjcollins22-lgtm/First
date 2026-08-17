"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Merge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { mergeContacts } from "@/lib/actions/contact-actions";
import type { ContactsData, ContactRow } from "@/lib/data/contacts";

function summary(contact: ContactRow): string {
  return (
    [contact.email, contact.phone, `${contact.propertyCount} propert${contact.propertyCount === 1 ? "y" : "ies"}`]
      .filter(Boolean)
      .join(" · ")
  );
}

export function ContactsManager({ data, canMerge }: { data: ContactsData; canMerge: boolean }) {
  const { contacts, duplicates } = data;

  return (
    <div className="flex flex-col gap-6">
      {duplicates.length > 0 && (
        <section className="rounded-xl border border-amber-400/70 bg-amber-50/60 p-4">
          <h2 className="mb-1 text-sm font-semibold">Possible duplicates ({duplicates.length})</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            These look like the same person entered twice. Nothing merges on its own — check each one, because
            two people really can share a surname or a driveway.
          </p>
          <div className="flex flex-col gap-2">
            {duplicates.map((pair) => (
              <MergeRow
                key={`${pair.keep.id}:${pair.merge.id}`}
                keepContact={pair.keep}
                mergeContact={pair.merge}
                reason={pair.reason}
                canMerge={canMerge}
              />
            ))}
          </div>
        </section>
      )}

      <ManualMerge contacts={contacts} canMerge={canMerge} />

      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold">All contacts ({contacts.length})</h2>
        {contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No contacts yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <Link
                  href={`/clients/${contact.id}`}
                  className="block rounded-lg border border-border p-2.5 hover:bg-accent/50"
                >
                  <p className="text-sm font-medium">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">{summary(contact)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MergeRow({
  keepContact,
  mergeContact,
  reason,
  canMerge,
}: {
  keepContact: ContactRow;
  mergeContact: ContactRow;
  reason: string;
  canMerge: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <p className="rounded-lg border border-emerald-400/70 bg-emerald-50/60 p-2.5 text-xs">
        Merged into <strong>{keepContact.name}</strong>. {message}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{reason}</p>

      <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{mergeContact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{summary(mergeContact)}</p>
        </div>
        <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{keepContact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{summary(keepContact)}</p>
        </div>
      </div>

      {canMerge && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          className="mt-2"
          onClick={() =>
            startTransition(async () => {
              const result = await mergeContacts(keepContact.id, mergeContact.id);
              if (result.ok) {
                setDone(true);
                setMessage(
                  result.movedProperties > 0
                    ? `${result.movedProperties} propert${result.movedProperties === 1 ? "y" : "ies"} moved across.`
                    : "Nothing was attached to it."
                );
              } else {
                setMessage(result.message);
              }
            })
          }
        >
          {isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-1.5 h-3.5 w-3.5" />}
          Merge into {keepContact.name}
        </Button>
      )}

      {message && !done && <p className="mt-1 text-xs text-destructive">{message}</p>}
    </div>
  );
}

function ManualMerge({ contacts, canMerge }: { contacts: ContactRow[]; canMerge: boolean }) {
  const [keepId, setKeepId] = useState("");
  const [mergeId, setMergeId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canMerge) return null;

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-1 text-sm font-semibold">Merge two contacts</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        For duplicates the suggestions above miss. Properties and everything under them move to the contact you
        keep; blank details get filled in from the other one, and nothing already filled in is overwritten.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Merge this one away
          <select
            value={mergeId}
            onChange={(e) => setMergeId(e.target.value)}
            className="h-11 rounded-lg border border-border bg-background px-3 py-2 text-base"
          >
            <option value="">Choose…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          Into this one (kept)
          <select
            value={keepId}
            onChange={(e) => setKeepId(e.target.value)}
            className="h-11 rounded-lg border border-border bg-background px-3 py-2 text-base"
          >
            <option value="">Choose…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Button
        type="button"
        size="sm"
        disabled={isPending || !keepId || !mergeId}
        className="mt-3"
        onClick={() =>
          startTransition(async () => {
            const result = await mergeContacts(keepId, mergeId);
            setMessage(
              result.ok
                ? `Merged. ${result.movedProperties} propert${result.movedProperties === 1 ? "y" : "ies"} moved across.`
                : result.message
            );
            if (result.ok) {
              setKeepId("");
              setMergeId("");
            }
          })
        }
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Merge
      </Button>

      {message && <p className="mt-2 text-xs">{message}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">There&apos;s no undo — check the names first.</p>
    </section>
  );
}
