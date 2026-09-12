"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarClock, Check, Eye, FileText, Trash2, Upload } from "lucide-react";

import {
  byUrgency,
  checkInvoiceFile,
  remainingCents,
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
import { InvoiceImportPanel } from "@/components/payments/invoice-import-panel";
import { ChosenContact, ContactPicker } from "@/components/payments/contact-picker";
import type { SearchableContact } from "@/lib/payer-match";
import { createPlan, recordManualPayment } from "@/lib/actions/payment-plan-actions";
import {
  buildSchedule,
  checkPlan,
  describePlan,
  INTERVALS,
  toCents,
  type Interval,
} from "@/lib/payment-plan";
import { planProgress } from "@/lib/plan-progress";
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
  "on-plan": "border-sky-300/70 bg-sky-50/70 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200",
  undated: "border-border bg-muted text-muted-foreground",
  "partly-paid": "border-amber-300/70 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
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
      {/* The backlog first: bringing a year of invoices in is the thing
          somebody does the first few times, and invisible once it is done. */}
      <InvoiceImportPanel />
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
        title: null,
        scopeHtml: null,
        sourceStatus: null,
        plan: null,
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
  const [planning, setPlanning] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

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
    if (!invoice.filePath) return;
    setError(null);
    start(async () => {
      const link = await invoiceFileLink(invoice.filePath!);
      if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
      else setError(link.message);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteInvoice(invoice.id, invoice.filePath ?? "");
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
            {invoice.fileName ?? invoice.title ?? "No file"}
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
            : invoice.lastPaidOn && status === "paid"
              ? `Paid ${day(invoice.lastPaidOn)}`
              : invoice.dueOn
                ? `Due ${day(invoice.dueOn)}`
                : `Issued ${day(invoice.issuedOn)}`}
        </span>
        {/* What is left, once money has started arriving against it. Reading
            "$4,520" on a bill that is half settled is the wrong number to
            act on. */}
        {(invoice.paidCents ?? 0) > 0 && remainingCents(invoice) > 0 && (
          <span className="text-muted-foreground">
            {money((invoice.paidCents ?? 0) / 100)} in · {money(remainingCents(invoice) / 100)} left
          </span>
        )}
      </div>

      {invoice.plan && <PlanProgressStrip invoice={invoice} />}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* Always here. An imported invoice has no PDF behind it, and before
            this there was nothing at all to open on one -- the record existed
            and could not be looked at. */}
        <button
          type="button"
          onClick={() => setShowDetail((was) => !was)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-semibold"
        >
          <Eye className="h-3.5 w-3.5" /> {showDetail ? "Close" : "View"}
        </button>
        {invoice.filePath && (
          <button
            type="button"
            disabled={pending}
            onClick={open}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" /> File
          </button>
        )}

        {status !== "paid" && !invoice.plan && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setPlanning((was) => !was)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Payment plan
          </button>
        )}

        {status !== "paid" && (
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

      {showDetail && <InvoiceDetail invoice={invoice} />}

      {planning && <NewInvoicePlan invoice={invoice} onClose={() => setPlanning(false)} />}

      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </li>
  );
}

/**
 * The schedule on this bill: where it has got to, and every payment in it.
 *
 * All of it here rather than on a screen of its own. A payment schedule is
 * not a thing anybody manages in the abstract -- it is how one invoice gets
 * paid, and sending somebody to another tab to tick off an instalment means
 * holding the invoice in your head while you look for it.
 */
function PlanProgressStrip({ invoice }: { invoice: ClientInvoice }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settledIds, setSettledIds] = useState<string[]>([]);

  if (!invoice.plan) return null;
  const plan = invoice.plan;
  const progress = planProgress(plan);
  const behind = progress.overdue.length > 0;

  function markPaid(instalmentId: string, amountCents: number) {
    setError(null);
    // Struck through immediately and put back if the write fails: the office
    // works down a list and should not wait on a round trip per row.
    setSettledIds((ids) => [...ids, instalmentId]);

    start(async () => {
      const result = await recordManualPayment({
        jobId: null,
        customerId: invoice.customerId,
        planId: plan.id,
        instalmentId,
        invoiceId: invoice.id,
        amountCents,
        method: "check",
        note: `Instalment on ${invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : "an invoice"}`,
      });

      if (!result.ok) {
        setSettledIds((ids) => ids.filter((id) => id !== instalmentId));
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${behind ? "bg-destructive" : "bg-emerald-500"}`}
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {money(plan.paidCents / 100)} of {money(plan.totalCents / 100)} paid
        {progress.next ? ` · next ${day(progress.next.dueOn)}` : ""}
      </p>
      {behind && (
        <p className="mt-0.5 text-xs font-semibold text-destructive">
          {progress.overdue.length} payment{progress.overdue.length === 1 ? "" : "s"} behind ·{" "}
          {money(progress.overdueCents / 100)}
        </p>
      )}

      <ul className="mt-2 space-y-0.5 border-l-2 border-border pl-2">
        {plan.schedule.map((item) => {
          const paid = item.status === "paid" || settledIds.includes(item.id);
          return (
            <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
              <span className={`truncate ${paid ? "text-muted-foreground line-through" : ""}`}>
                {item.isDeposit ? "Deposit" : `Payment ${item.number}`} · {day(item.dueOn)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="tabular-nums text-muted-foreground">
                  {money(item.amountCents / 100)}
                </span>
                {!paid && item.status !== "cancelled" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => markPaid(item.id, item.amountCents)}
                    className="rounded border border-emerald-300/70 bg-emerald-50/70 px-1.5 py-0.5 text-[11px] font-semibold disabled:opacity-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                  >
                    Paid
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-1 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Splitting one bill into payments.
 *
 * Pre-filled from the invoice, because the total is not something anybody
 * should be retyping off the card above it. The schedule is drawn before it
 * is saved: the plan the client agreed to on the phone and the one the
 * software worked out are meant to be the same list.
 */
function NewInvoicePlan({
  invoice,
  onClose,
}: {
  invoice: ClientInvoice;
  onClose: () => void;
}) {
  const router = useRouter();
  const [deposit, setDeposit] = useState("");
  const [count, setCount] = useState("3");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [startOn, setStartOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = {
    kind: "instalments" as const,
    totalCents: toCents(invoice.amount ?? 0),
    depositCents: toCents(Number(deposit.replace(/[^0-9.]/g, "")) || 0),
    instalments: Number(count) || 1,
    interval,
  };

  const verdict = checkPlan(input);
  const preview = verdict.ok ? buildSchedule(input) : [];

  async function save() {
    if (!verdict.ok) return;
    setBusy(true);
    setError(null);

    const result = await createPlan({
      ...input,
      jobId: null,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      startOn,
      alreadyAgreed: true,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  if (invoice.amount == null) {
    return (
      <div className="mt-2 rounded-md border border-border bg-background p-2">
        <p className="text-xs text-muted-foreground">
          This invoice has no amount on it, so there is nothing to split. Add one first.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">
          Split {money(invoice.amount)} into payments
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      {/* Two columns, not three: a date input at a third of a phone's width
          clips its own year. */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Deposit" value={deposit} onChange={setDeposit} placeholder="$0" inputMode="decimal" />
        <Field label="How many" value={count} onChange={setCount} placeholder="3" inputMode="decimal" />
        <div className="col-span-2">
          <Field label="Starts" value={startOn} onChange={setStartOn} type="date" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            type="button"
            onClick={() => setInterval(i.value)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              interval === i.value
                ? "bg-foreground text-background"
                : "border border-border bg-background"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {verdict.ok ? (
        <div className="rounded-md border border-border p-2">
          <p className="mb-1 text-xs font-semibold">{describePlan(input)}</p>
          <ul className="space-y-0.5">
            {preview.slice(0, 6).map((item) => (
              <li
                key={item.number}
                className="flex justify-between gap-2 text-[11px] text-muted-foreground"
              >
                <span>
                  {item.isDeposit ? "Deposit" : `Payment ${item.number}`} ·{" "}
                  {item.dueInDays === 0 ? "now" : `in ${item.dueInDays} days`}
                </span>
                <span className="tabular-nums">{money(item.amountCents / 100)}</span>
              </li>
            ))}
            {preview.length > 6 && (
              <li className="text-[11px] text-muted-foreground">
                and {preview.length - 6} more
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{verdict.reason}</p>
      )}

      <button
        type="button"
        disabled={busy || !verdict.ok}
        onClick={save}
        className="w-full rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
      >
        {busy ? "Setting up…" : "Put this invoice on a plan"}
      </button>

      <p className="text-[11px] text-muted-foreground">
        While a plan is running this bill stops reading as overdue. It goes back to overdue if a
        payment is missed.
      </p>

      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The invoice itself, readable.
 *
 * There was nothing to open on an imported invoice. It had no PDF behind it,
 * so the "Open" button did not appear, and the record existed while being
 * impossible to look at — the number, the dates, the scope of work and what
 * had been paid all sat in the database with no screen showing them.
 *
 * Laid out as the bill reads rather than as the table stores it: what it was
 * for, what it came to, what has arrived against it, and what is left.
 */
function InvoiceDetail({ invoice }: { invoice: ClientInvoice }) {
  const status = invoiceStatus(invoice);
  const paid = invoice.paidCents ?? 0;
  const left = remainingCents(invoice);

  return (
    <div className="mt-2 rounded-md border border-border bg-background">
      <div className="border-b border-border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">
            {invoice.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : "Invoice"}
          </p>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${TONE[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        {invoice.title && <p className="text-xs text-muted-foreground">{invoice.title}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {invoice.customerName ?? "Unnamed contact"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-border p-3 text-xs">
        <Line label="Issued" value={day(invoice.issuedOn)} />
        <Line label="Due" value={day(invoice.dueOn)} />
        <Line label="Amount" value={money(invoice.amount)} />
        <Line
          label="Paid"
          value={paid > 0 ? `${money(paid / 100)}${invoice.lastPaidOn ? ` · ${day(invoice.lastPaidOn)}` : ""}` : "—"}
        />
        {left > 0 && paid > 0 && <Line label="Outstanding" value={money(left / 100)} strong />}
      </dl>

      {invoice.plan && (
        <div className="border-b border-border p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Payment plan
          </p>
          <p className="text-xs text-muted-foreground">
            {money(invoice.plan.paidCents / 100)} of {money(invoice.plan.totalCents / 100)} across{" "}
            {invoice.plan.schedule.length} payments.
          </p>
        </div>
      )}

      {invoice.scopeHtml ? (
        <div className="p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Scope of work
          </p>
          {/* Rendered rather than shown as markup: it is a document somebody
              needs to read, and it comes from our own export rather than from
              anything a client typed. */}
          <div
            className="prose prose-sm max-h-72 max-w-none overflow-y-auto text-xs dark:prose-invert [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs"
            dangerouslySetInnerHTML={{ __html: invoice.scopeHtml }}
          />
        </div>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">
          No scope of work stored on this one.
        </p>
      )}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
