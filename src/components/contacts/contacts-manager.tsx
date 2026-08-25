"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Merge, Pencil, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createContact,
  deleteContact,
  mergeContacts,
  updateContact,
} from "@/lib/actions/contact-actions";
import type { ContactsData, ContactRow } from "@/lib/data/contacts";
import { CONTACT_TYPES, contactTypeLabel } from "@/lib/contact-types";
import { ContactImportPanel } from "./contact-import-panel";

function summary(contact: ContactRow): string {
  return (
    [
      contactTypeLabel(contact.contactType),
      contact.email,
      contact.phone,
      `${contact.propertyCount} propert${contact.propertyCount === 1 ? "y" : "ies"}`,
      contact.doNotContact ? "DO NOT CONTACT" : null,
    ]
      .filter(Boolean)
      .join(" · ")
  );
}

export function ContactsManager({ data, canMerge }: { data: ContactsData; canMerge: boolean }) {
  const { contacts, duplicates } = data;
  const [adding, setAdding] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Counted before filtering, so a tab reading zero is a fact about the book
  // rather than about the tab that happens to be selected.
  const counts = new Map<string, number>();
  for (const contact of contacts) {
    counts.set(contact.contactType, (counts.get(contact.contactType) ?? 0) + 1);
  }
  const shown = typeFilter === "all" ? contacts : contacts.filter((c) => c.contactType === typeFilter);

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

      <ContactImportPanel />

      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">All contacts ({shown.length})</h2>
          <Button type="button" size="sm" className="min-h-9" onClick={() => setAdding((v) => !v)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            {adding ? "Cancel" : "Add contact"}
          </Button>
        </div>

        {/* Only the kinds actually present. Offering six tabs to a book that
            holds one kind is six taps to learn nothing. */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <TypeChip label={`Everyone (${contacts.length})`} active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
          {CONTACT_TYPES.filter((t) => (counts.get(t.value) ?? 0) > 0).map((t) => (
            <TypeChip
              key={t.value}
              label={`${t.label} (${counts.get(t.value)})`}
              active={typeFilter === t.value}
              onClick={() => setTypeFilter(t.value)}
            />
          ))}
        </div>

        {adding && <ContactForm onDone={() => setAdding(false)} />}

        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {contacts.length === 0 ? "No contacts yet." : "None of that kind."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((contact) => (
              <ContactRowItem key={contact.id} contact={contact} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-8 rounded-full border px-3 text-xs font-medium ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent/50"
      }`}
    >
      {label}
    </button>
  );
}

/** One contact: opens to the record, or expands in place to be edited. */
function ContactRowItem({ contact }: { contact: ContactRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-primary/50 bg-primary/5 p-2.5">
        <ContactForm contact={contact} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border">
      <div className="flex items-center">
        <Link href={`/clients/${contact.id}`} className="min-w-0 flex-1 p-2.5 hover:bg-accent/50">
          <p className="truncate text-sm font-medium">{contact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{summary(contact)}</p>
        </Link>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${contact.name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

/**
 * Add or edit, in one form.
 *
 * onSubmit rather than a form action: an action clears the fields the instant
 * it is submitted, wiping what somebody typed before validation reads it.
 */
function ContactForm({ contact, onDone }: { contact?: ContactRow; onDone: () => void }) {
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const input = { name, email: email || null, phone: phone || null };
      const result = contact
        ? await updateContact(contact.id, input)
        : await createContact(input);

      if (!result.ok) return setError(result.message);
      setMessage(result.message ?? null);
      if (contact) onDone();
      else {
        setName("");
        setEmail("");
        setPhone("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
      <label className="flex flex-col gap-1 text-xs font-medium">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mike Harrow" autoFocus />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Email
          <Input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Phone
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {message && <p className="text-xs text-emerald-700">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="min-h-11 sm:min-h-9" disabled={isPending}>
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {contact ? "Save" : "Add"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          disabled={isPending}
          onClick={onDone}
        >
          {contact ? "Cancel" : "Done"}
        </Button>

        {contact && !confirmingDelete && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmingDelete(true)}
            className="ml-auto flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        )}
      </div>

      {contact && confirmingDelete && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5">
          <p className="mb-2 text-xs font-semibold">Remove {contact.name}?</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="min-h-11 sm:min-h-9"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteContact(contact.id);
                  if (!result.ok) {
                    setError(result.message);
                    setConfirmingDelete(false);
                  } else onDone();
                })
              }
            >
              Yes, remove
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={isPending}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep
            </Button>
          </div>
        </div>
      )}
    </form>
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
