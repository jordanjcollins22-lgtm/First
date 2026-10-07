"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Circle, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { addCompany, markCompany, rewriteSequence, runPmNow, savePmSettings, saveSequence, setCompanyEmail, type PmResult } from "@/lib/actions/pm-outreach-actions";
import type { PmBoard, PmCompanyRow } from "@/lib/data/pm-board";

const STATUS: Record<string, string> = {
  new: "Looking for email",
  no_email: "No email found",
  ready: "Being written",
  drafted: "To review",
  approved: "Sending",
  replied: "Replied",
  interested: "Interested",
  not_interested: "Not interested",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  do_not_contact: "Do not contact",
};

const FILTERS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "review", label: "To review", statuses: ["drafted"] },
  { key: "replied", label: "Replied", statuses: ["replied", "interested"] },
  { key: "sending", label: "Sending", statuses: ["approved"] },
  { key: "email", label: "Needs an email", statuses: ["new", "no_email", "ready", "bounced"] },
  { key: "all", label: "All", statuses: null },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";

function Note({ result }: { result: PmResult | null }) {
  if (!result) return null;
  return <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-destructive"}`}>{result.message}</p>;
}

/**
 * Cold email to local property managers: what's still needed before it can
 * send, the funnel, the settings, and every company with its three emails to
 * read, edit and approve.
 */
export function PropertyManagers({ board }: { board: PmBoard }) {
  const [filter, setFilter] = useState(board.counts.drafted ? "review" : board.counts.replied ? "replied" : "all");
  const [runResult, setRunResult] = useState<PmResult | null>(null);
  const [running, startRun] = useTransition();

  const funnel = useMemo(() => {
    const c = board.companies;
    const sent = c.reduce((n, r) => n + r.emails.filter((e) => e.status === "sent").length, 0);
    return [
      { label: "Found", value: c.length },
      { label: "With an email", value: c.filter((r) => r.email).length },
      { label: "Approved", value: c.filter((r) => r.emails.some((e) => e.status === "scheduled" || e.status === "sent")).length },
      { label: "Emails sent", value: sent },
      { label: "Replied", value: c.filter((r) => r.repliedAt).length },
      { label: "Interested", value: board.counts.interested ?? 0 },
    ];
  }, [board]);

  const shown = board.companies.filter((r) => {
    const f = FILTERS.find((x) => x.key === filter);
    return !f?.statuses || f.statuses.includes(r.status);
  });
  const missing = board.checks.filter((c) => !c.done);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Property managers</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Finds property management companies in your towns, finds their office email, writes three short emails in your words, and sends a few
            each weekday morning. A reply stops their emails and tells you straight away.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={running}
          onClick={() => startRun(async () => setRunResult(await runPmNow()))}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run now
        </Button>
      </div>
      <Note result={runResult} />

      {missing.length > 0 && (
        <div className="rounded-lg border bg-amber-50/70 p-4">
          <p className="mb-2 font-semibold">Before anything goes out</p>
          <ul className="flex flex-col gap-2">
            {board.checks.map((c) => (
              <li key={c.key} className="flex gap-2 text-sm">
                {c.done ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span>
                  <span className={c.done ? "text-muted-foreground line-through" : "font-medium"}>{c.label}</span>
                  {!c.done && <span className="text-muted-foreground"> · {c.how}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {funnel.map((f) => (
          <div key={f.label} className="rounded-lg border bg-white/50 p-3">
            <p className="text-2xl font-bold tabular-nums">{f.value}</p>
            <p className="text-xs text-muted-foreground">{f.label}</p>
          </div>
        ))}
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">
        {board.sentToday} sent today{board.mailboxFrom ? ` from ${board.mailboxFrom}` : ""}. Weekdays, 8am to 4pm. A new mailbox starts at 5 a day and builds up to your cap.
      </p>

      <Settings board={board} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const n = f.statuses ? board.companies.filter((r) => f.statuses!.includes(r.status)).length : board.companies.length;
            return (
              <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
                {f.label} ({n})
              </Button>
            );
          })}
        </div>
        {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
        {shown.map((r) => (
          <CompanyCard key={`${r.id}:${r.status}:${r.emails.map((e) => e.id).join(",")}`} row={r} />
        ))}
      </div>

      <AddCompany />
    </section>
  );
}

function Settings({ board }: { board: PmBoard }) {
  const s = board.settings;
  const [open, setOpen] = useState(!s.sendingOn);
  const [sendingOn, setSendingOn] = useState(s.sendingOn);
  const [autoApprove, setAutoApprove] = useState(s.autoApprove);
  const [dailyCap, setDailyCap] = useState(String(s.dailyCap));
  const [fromName, setFromName] = useState(s.fromName);
  const [story, setStory] = useState(s.story);
  const [offer, setOffer] = useState(s.offer);
  const [towns, setTowns] = useState(s.towns.join("\n"));
  const [result, setResult] = useState<PmResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-lg border bg-white/40 p-4">
      <button type="button" className="flex w-full items-center justify-between text-left font-semibold" onClick={() => setOpen(!open)}>
        <span>Settings {s.sendingOn ? <Badge className="ml-2">Sending on</Badge> : <Badge variant="outline" className="ml-2">Sending off</Badge>}</span>
        <span className="text-sm text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={sendingOn} onChange={(e) => setSendingOn(e.target.checked)} />
            Send approved emails
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
            Skip my review: new emails go out without me reading them
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Most a day
            <Input type="number" min={1} max={50} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            From name
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Jordan Collins" />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Your story (the writer uses this and never adds to it)
            <Textarea rows={5} value={story} onChange={(e) => setStory(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            What we offer
            <Textarea rows={3} value={offer} onChange={(e) => setOffer(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Towns to search, one a line{s.lastSearchAt ? ` (last searched ${when(s.lastSearchAt)})` : ""}
            <Textarea rows={5} value={towns} onChange={(e) => setTowns(e.target.value)} />
          </label>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button
              disabled={pending}
              onClick={() =>
                start(async () =>
                  setResult(await savePmSettings({ sendingOn, autoApprove, dailyCap: Number(dailyCap), fromName, story, offer, towns }))
                )
              }
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save settings
            </Button>
            <Note result={result} />
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyCard({ row }: { row: PmCompanyRow }) {
  const [open, setOpen] = useState(row.status === "drafted" || row.status === "replied");
  const [result, setResult] = useState<PmResult | null>(null);
  const [pending, start] = useTransition();
  const [edits, setEdits] = useState(() => row.emails.map((e) => ({ id: e.id, subject: e.subject, body: e.body })));
  const [email, setEmail] = useState(row.email ?? "");
  const [contact, setContact] = useState(row.contactName ?? "");
  const editable = row.status === "drafted" || row.status === "approved";
  const needsEmail = ["new", "no_email", "ready", "bounced"].includes(row.status);
  const stopped = ["not_interested", "unsubscribed", "do_not_contact"].includes(row.status);
  const act = (fn: () => Promise<PmResult>) => start(async () => setResult(await fn()));

  return (
    <div className="rounded-lg border bg-white/50 p-4">
      <button type="button" className="flex w-full flex-wrap items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <div>
          <p className="font-semibold">{row.name}</p>
          <p className="text-xs text-muted-foreground">
            {[row.address, row.email, row.phone].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Badge variant={row.status === "replied" || row.status === "interested" ? "default" : row.status === "drafted" ? "secondary" : "outline"}>
          {STATUS[row.status] ?? row.status}
        </Badge>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          {row.website && (
            <a className="text-sm text-primary underline" href={/^https?:/.test(row.website) ? row.website : `https://${row.website}`} target="_blank" rel="noreferrer">
              {row.website}
            </a>
          )}
          {row.lastReply && (
            <div className="rounded-md border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold">They replied {when(row.repliedAt)}</p>
              <p className="whitespace-pre-wrap">{row.lastReply}</p>
            </div>
          )}
          {row.lastError && <p className="text-sm text-destructive">{row.lastError}</p>}

          {needsEmail && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="office@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input placeholder="Contact name (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
              <Button disabled={pending} onClick={() => act(() => setCompanyEmail(row.id, email, contact))}>
                Save email
              </Button>
            </div>
          )}

          {row.emails.map((e, i) => (
            <div key={e.id} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                Email {e.step}
                {e.status === "sent" && ` · sent ${when(e.sentAt)}`}
                {e.status === "scheduled" && ` · goes ${when(e.sendAfter)}`}
                {e.status === "skipped" && " · stopped"}
                {e.error && ` · ${e.error}`}
              </p>
              {editable && (e.status === "draft" || e.status === "scheduled") ? (
                <>
                  <Input
                    value={edits[i]?.subject ?? ""}
                    onChange={(ev) => setEdits(edits.map((x, j) => (j === i ? { ...x, subject: ev.target.value } : x)))}
                  />
                  <Textarea
                    rows={Math.min(16, Math.max(4, (edits[i]?.body ?? "").split("\n").length + 2))}
                    value={edits[i]?.body ?? ""}
                    onChange={(ev) => setEdits(edits.map((x, j) => (j === i ? { ...x, body: ev.target.value } : x)))}
                  />
                </>
              ) : (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{e.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap">{e.body}</p>
                </div>
              )}
            </div>
          ))}
          {row.emails.length > 0 && (
            <p className="text-xs text-muted-foreground">Each email ends with the business name, its address and a link to stop the emails.</p>
          )}

          <div className="flex flex-wrap gap-2">
            {row.status === "drafted" && (
              <Button disabled={pending} onClick={() => act(() => saveSequence({ companyId: row.id, emails: edits, approve: true }))}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve and schedule
              </Button>
            )}
            {editable && (
              <Button variant="outline" disabled={pending} onClick={() => act(() => saveSequence({ companyId: row.id, emails: edits, approve: false }))}>
                Save changes
              </Button>
            )}
            {editable && (
              <Button variant="outline" disabled={pending} onClick={() => act(() => rewriteSequence(row.id))}>
                Write again
              </Button>
            )}
            {!stopped && row.status !== "interested" && (
              <Button variant="outline" disabled={pending} onClick={() => act(() => markCompany(row.id, "interested"))}>
                Interested
              </Button>
            )}
            {!stopped && (
              <Button variant="ghost" disabled={pending} onClick={() => act(() => markCompany(row.id, "not_interested"))}>
                Not interested
              </Button>
            )}
            {row.status !== "do_not_contact" && (
              <Button variant="ghost" disabled={pending} onClick={() => act(() => markCompany(row.id, "do_not_contact"))}>
                Do not contact
              </Button>
            )}
          </div>
          <Note result={result} />
        </div>
      )}
    </div>
  );
}

function AddCompany() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", contactName: "", website: "", phone: "", address: "" });
  const [result, setResult] = useState<PmResult | null>(null);
  const [pending, start] = useTransition();
  const field = (key: keyof typeof form, placeholder: string) => (
    <Input placeholder={placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
  );

  if (!open) {
    return (
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Add a company by hand
      </Button>
    );
  }
  return (
    <div className="rounded-lg border bg-white/40 p-4">
      <p className="mb-3 font-semibold">Add a company</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("name", "Company name")}
        {field("email", "Email (if you have it)")}
        {field("contactName", "Contact name")}
        {field("website", "Website")}
        {field("phone", "Phone")}
        {field("address", "Address")}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await addCompany(form);
              setResult(r);
              if (r.ok) setForm({ name: "", email: "", contactName: "", website: "", phone: "", address: "" });
            })
          }
        >
          Add
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
        <Note result={result} />
      </div>
    </div>
  );
}
