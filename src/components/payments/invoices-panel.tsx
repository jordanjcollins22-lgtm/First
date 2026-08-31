"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, Check, FileText, Trash2, Upload } from "lucide-react";

import {
  byUrgency,
  checkInvoiceFile,
  daysOverdue,
  invoiceLine,
  invoiceStatus,
  numberFromFileName,
  STATUS_LABEL,
  summariseInvoices,
  type ClientInvoice,
  type InvoiceStatus,
} from "@/lib/client-invoices";
import { createClient } from "@/lib/supabase/client";
import { ChosenContact, ContactPicker } from "@/components/payments/contact-picker";
import type { SearchableContact } from "@/lib/payer-match";
import {
  createInvoiceUpload,
  deleteInvoice,
  invoiceFileLink,
  saveInvoice,
  updateInvoice,
} from "@/lib/actions/invoice-actions";

function money(amount: number | null): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TONE: Record<InvoiceStatus, string> = {
  overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  "due-soon": "border-amber-300/70 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  outstanding: "border-border bg-muted text-muted-foreground",
  undated: "border-border bg-muted text-muted-foreground",
  paid: "border-emerald-300/70 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
};

/**
 * Invoices, as files, against the person they were sent to.
 *
 * Two halves: put one in, and work through the ones that are in. The list is
 * ordered by what needs chasing rather than by when it was filed, because the
 * only reason to open this is to find out who owes what.
 */
export function InvoicesPanel({
  initial,
  hasMore,
}: {
  initial: ClientInvoice[];
  hasMore: boolean;
}) {
  const [invoices, setInvoices] = useState(initial);
  const [filter, setFilter] = useState<"owed" | "all">("owed");

  const summary = useMemo(() => summariseInvoices(invoices), [invoices]);
  const shown = useMemo(() => {
    const ordered = byUrgency(invoices);
    return filter === "all" ? ordered : ordered.filter((i) => !i.paidOn);
  }, [invoices, filter]);

  return (
    <div className="space-y-4">
      <UploadInvoice onSaved={(inv) => setInvoices((all) => [inv, ...all])} />

      <div>
        <p className="mb-2 text-sm text-muted-foreground">{invoiceLine(summary)}</p>

        <div className="mb-2 flex gap-1.5">
          <FilterButton active={filter === "owed"} onClick={() => setFilter("owed")}>
            Owed ({summary.outstanding})
          </FilterButton>
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
            All ({summary.total})
          </FilterButton>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
            {invoices.length === 0
              ? "No invoices yet. Upload one above and it lands on the contact's record."
              : "Nothing outstanding. Everything on file has been paid."}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                onChanged={(next) =>
                  setInvoices((all) => all.map((i) => (i.id === next.id ? next : i)))
                }
                onRemoved={() => setInvoices((all) => all.filter((i) => i.id !== invoice.id))}
              />
            ))}
          </ul>
        )}

        {hasMore && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Showing the most recent {initial.length}. Older invoices stay on each contact&apos;s
            record.
          </p>
        )}
      </div>
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

/**
 * Putting one in.
 *
 * The contact comes first and the file second, because the file's path is
 * built from the contact and there is nowhere to put it until somebody has
 * said whose it is.
 *
 * The file goes straight to storage on a signed URL. A Server Action carries
 * one megabyte and a scanned invoice is several, so sending it through the
 * app would fail on exactly the documents worth keeping.
 */
function UploadInvoice({ onSaved }: { onSaved: (invoice: ClientInvoice) => void }) {
  const [contact, setContact] = useState<SearchableContact | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [paid, setPaid] = useState(false);
  const [paidOn, setPaidOn] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setNumber("");
    setAmount("");
    setIssuedOn("");
    setDueOn("");
    setPaid(false);
    setPaidOn("");
    setNotes("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function pickFile(picked: File | null) {
    setError(null);
    setDone(null);
    if (!picked) {
      setFile(null);
      return;
    }

    const check = checkInvoiceFile(picked);
    if (!check.ok) {
      setError(check.message);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setFile(picked);
    // The number is nearly always in the file name already. Offered, and only
    // when it is clear enough to be right.
    const guess = numberFromFileName(picked.name);
    if (guess && !number) setNumber(guess);
  }

  async function upload() {
    if (!contact || !file) return;
    setBusy(true);
    setError(null);

    try {
      const slot = await createInvoiceUpload({
        customerId: contact.id,
        fileType: file.type,
        fileSize: file.size,
      });
      if (!slot.ok) {
        setError(slot.message);
        return;
      }

      const put = await createClient()
        .storage.from("invoices")
        .uploadToSignedUrl(slot.path, slot.token, file);
      if (put.error) {
        setError(put.error.message);
        return;
      }

      const saved = await saveInvoice({
        customerId: contact.id,
        filePath: slot.path,
        fileName: file.name,
        invoiceNumber: number,
        amount,
        issuedOn,
        dueOn,
        paidOn: paid ? paidOn || new Date().toISOString().slice(0, 10) : "",
      });
      if (!saved.ok) {
        setError(saved.message);
        return;
      }

      onSaved({
        id: saved.id,
        customerId: contact.id,
        customerName: contact.name,
        filePath: slot.path,
        fileName: file.name,
        invoiceNumber: number.trim() || null,
        amount: amount ? Number(amount.replace(/[^0-9.]/g, "")) || null : null,
        issuedOn: issuedOn || null,
        dueOn: dueOn || null,
        paidOn: paid ? paidOn || new Date().toISOString().slice(0, 10) : null,
        notes: notes.trim() || null,
      });
      setDone(`Filed against ${contact.name ?? "that contact"}.`);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Upload className="h-4 w-4" /> Upload an invoice
      </p>

      {contact ? (
        <div className="mb-2">
          <ChosenContact contact={contact} onClear={() => setContact(null)} />
        </div>
      ) : (
        <ContactPicker onPick={setContact} placeholder="Which contact is this invoice for?" />
      )}

      {contact && (
        <div className="space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-semibold"
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Invoice number" value={number} onChange={setNumber} placeholder="1042" />
            <Field label="Amount" value={amount} onChange={setAmount} placeholder="$1,200" inputMode="decimal" />
            <Field label="Issued" value={issuedOn} onChange={setIssuedOn} type="date" />
            <Field label="Due" value={dueOn} onChange={setDueOn} type="date" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
              className="h-4 w-4"
            />
            Already paid
          </label>
          {paid && (
            <Field label="Paid on" value={paidOn} onChange={setPaidOn} type="date" />
          )}

          <button
            type="button"
            disabled={busy || !file}
            onClick={upload}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload and file it"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" /> {done}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "decimal";
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  );
}

/** One invoice: what it was for, where it stands, and the two things anybody
 * does to it — open the file, or say it has been paid. */
function InvoiceCard({
  invoice,
  onChanged,
  onRemoved,
}: {
  invoice: ClientInvoice;
  onChanged: (next: ClientInvoice) => void;
  onRemoved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const status = invoiceStatus(invoice);
  const late = daysOverdue(invoice);

  function markPaid() {
    const today = new Date().toISOString().slice(0, 10);
    // Shown as paid straight away and put back if the write fails: the office
    // is working down a list and should not wait on a round trip per row.
    const before = invoice;
    onChanged({ ...invoice, paidOn: today });
    setError(null);

    start(async () => {
      const result = await updateInvoice(invoice.id, { paidOn: today });
      if (!result.ok) {
        onChanged(before);
        setError(result.message);
      }
    });
  }

  function open() {
    setError(null);
    start(async () => {
      const link = await invoiceFileLink(invoice.filePath);
      if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
      else setError(link.message);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteInvoice(invoice.id, invoice.filePath);
      if (result.ok) onRemoved();
      else setError(result.message);
    });
  }

  return (
    <li className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {invoice.customerName ?? "Unnamed contact"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {invoice.invoiceNumber ? `#${invoice.invoiceNumber} · ` : ""}
            {invoice.fileName}
          </p>
        </div>
        <p className="shrink-0 text-base font-bold">{money(invoice.amount)}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded border px-1.5 py-0.5 font-semibold ${TONE[status]}`}>
          {STATUS_LABEL[status]}
          {late > 0 ? ` by ${late} day${late === 1 ? "" : "s"}` : ""}
        </span>
        <span className="text-muted-foreground">
          {invoice.paidOn
            ? `Paid ${day(invoice.paidOn)}`
            : invoice.dueOn
              ? `Due ${day(invoice.dueOn)}`
              : `Issued ${day(invoice.issuedOn)}`}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={open}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" /> Open
        </button>

        {!invoice.paidOn && (
          <button
            type="button"
            disabled={pending}
            onClick={markPaid}
            className="flex items-center gap-1 rounded-md border border-emerald-300/70 bg-emerald-50/70 px-2 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
          >
            <Check className="h-3.5 w-3.5" /> Mark paid
          </button>
        )}

        {confirming ? (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50"
            >
              Delete for good
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-1 text-xs font-semibold text-muted-foreground"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </li>
  );
}
