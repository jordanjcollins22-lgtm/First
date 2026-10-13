"use client";

import { money } from "@/lib/marketing/money";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, MapPin, Play, RefreshCw, Square, Upload } from "lucide-react";

import {
  addManualSpend,
  approveReviewReply,
  assignPlayTo,
  draftReplyNow,
  expireStalePlays,
  markPlayDone,
  previewSeasonal,
  recordPlayTrail,
  runGoogleNow,
  saveAutopilotSettings,
  seedRankNow,
  skipPlay,
  skipReviewReply,
  startSeasonal,
  uploadSpendCsv,
} from "@/lib/actions/marketing-autopilot-actions";
import type { SeasonPreview } from "@/lib/data/seasonal-run";
import { AUTOMATION_LABEL, type Automation, type AutopilotSettings, type StartedMap } from "@/lib/marketing/autopilot-settings";
import { SEASON_INFO, type Season } from "@/lib/marketing/seasonal";
import { SPEND_CHANNEL_LABEL, SPEND_CHANNELS, type ChannelReport } from "@/lib/marketing/spend";

/**
 * The buttons and switches on the three marketing panels. Each one calls a
 * server action that checks who is pressing it; these only draw the result.
 */


function Message({ text, error }: { text: string | null; error?: boolean }) {
  if (!text) return null;
  return <p className={"text-sm " + (error ? "font-medium text-destructive" : "text-muted-foreground")}>{text}</p>;
}

const btn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

// ---------------------------------------------------------------------------
// Switches and settings

export function AutomationSwitches({ keys, settings, started }: { keys: Automation[]; settings: AutopilotSettings; started: StartedMap }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function flip(key: Automation, value: boolean) {
    setError(null);
    setEnabled((e) => ({ ...e, [key]: value }));
    start(async () => {
      const r = await saveAutopilotSettings({ enabled: { ...enabled, [key]: value } });
      if (!r.ok) {
        setError(r.error);
        setEnabled((e) => ({ ...e, [key]: !value }));
      }
    });
  }
  return (
    <div className="grid gap-1.5">
      {keys.map((key) => (
        <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={enabled[key]} disabled={pending} onChange={(e) => flip(key, e.target.checked)} />
          <span className="flex-1 font-medium">{AUTOMATION_LABEL[key]}</span>
          <span className="text-xs text-muted-foreground">
            {enabled[key] ? (started[key] ? `on since ${new Date(started[key] as string).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "on") : "off"}
          </span>
        </label>
      ))}
      <Message text={error} error />
    </div>
  );
}

/**
 * One number setting. Described as data, not a function: these are drawn on
 * the server and handed to the browser, which can't be given a function.
 * `setting` is the settings key, or "unitCostCents.<item>" for a unit cost;
 * what is typed is multiplied by `scale` before it is saved.
 */
type NumberField = { key: string; label: string; value: number; step?: number; suffix?: string; setting: string; scale?: number; whole?: boolean };

function patchFor(f: NumberField, typed: number): Partial<AutopilotSettings> {
  const raw = Number((typed * (f.scale ?? 1)).toFixed(6));
  const v = f.whole ? Math.round(raw) : raw;
  const [head, item] = f.setting.split(".");
  if (head === "unitCostCents" && item) return { unitCostCents: { [item]: v } } as Partial<AutopilotSettings>;
  return { [head]: v } as Partial<AutopilotSettings>;
}

export function NumberSettings({ fields }: { fields: NumberField[] }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, String(f.value)])));
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  function save() {
    setNote(null);
    const patch: Partial<AutopilotSettings> = {};
    for (const f of fields) {
      const n = Number(values[f.key]);
      if (!Number.isFinite(n)) return setNote({ text: `${f.label} isn't a number.`, error: true });
      const part = patchFor(f, n);
      Object.assign(patch, part, part.unitCostCents ? { unitCostCents: { ...(patch.unitCostCents ?? {}), ...part.unitCostCents } } : {});
    }
    start(async () => {
      const r = await saveAutopilotSettings(patch);
      setNote(r.ok ? { text: "Saved." } : { text: r.error, error: true });
    });
  }
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="grid gap-1 text-sm">
            <span className="font-medium">{f.label}</span>
            <span className="flex items-center gap-1.5">
              <input
                inputMode="decimal"
                value={values[f.key]}
                step={f.step}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="min-h-11 w-full rounded-md border bg-background px-2.5"
              />
              {f.suffix && <span className="text-xs text-muted-foreground">{f.suffix}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className={btn} disabled={pending} onClick={save}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
        {note && <Message text={note.text} error={note.error} />}
      </div>
    </div>
  );
}

export function SeasonalModeForm({ mode, goLive }: { mode: "owner" | "auto"; goLive: string | null }) {
  const [m, setM] = useState(mode);
  const [d, setD] = useState(goLive ?? "");
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        {(["owner", "auto"] as const).map((v) => (
          <label key={v} className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3">
            <input type="radio" name="seasonal-mode" checked={m === v} onChange={() => setM(v)} className="size-4" />
            {v === "owner" ? "I start each season after a preview" : "Start on its own"}
          </label>
        ))}
      </div>
      {m === "auto" && (
        <label className="grid gap-1">
          <span className="font-medium">Go-live date (nothing sends automatically before it)</span>
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} className="min-h-11 rounded-md border bg-background px-2.5" />
        </label>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveAutopilotSettings({ seasonalMode: m, seasonalGoLive: m === "auto" ? d || null : null });
              setNote(r.ok ? { text: m === "auto" && !d ? "Saved. Set a go-live date or nothing starts on its own." : "Saved." } : { text: r.error, error: true });
            })
          }
        >
          Save
        </button>
        {note && <Message text={note.text} error={note.error} />}
      </div>
    </div>
  );
}

export function ListSettings({ towns, services }: { towns: string[]; services: string[] }) {
  const [t, setT] = useState(towns.join(", "));
  const [s, setS] = useState(services.join(", "));
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const split = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="grid gap-2 text-sm">
      <label className="grid gap-1">
        <span className="font-medium">Towns</span>
        <textarea rows={2} value={t} onChange={(e) => setT(e.target.value)} className="rounded-md border bg-background px-2.5 py-1.5" />
      </label>
      <label className="grid gap-1">
        <span className="font-medium">Services</span>
        <input value={s} onChange={(e) => setS(e.target.value)} className="min-h-11 rounded-md border bg-background px-2.5" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveAutopilotSettings({ rankTowns: split(t), rankServices: split(s) });
              setNote(r.ok ? { text: "Saved; any new phrases are now tracked." } : { text: r.error, error: true });
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await seedRankNow();
              setNote(r.ok ? { text: r.value ? `${r.value} phrases added to the tracker.` : "Every phrase is already tracked." } : { text: r.error, error: true });
            })
          }
        >
          Add missing phrases now
        </button>
        {note && <Message text={note.text} error={note.error} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channels

export function ChannelTable({ periods, hasSpend }: { periods: ChannelReport[]; hasSpend: boolean }) {
  const [i, setI] = useState(0);
  const p = periods[i];
  if (!p) return null;
  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Period" className="flex gap-1.5">
        {periods.map((x, j) => (
          <button
            key={x.days}
            type="button"
            role="tab"
            aria-selected={i === j}
            onClick={() => setI(j)}
            className={"min-h-11 rounded-lg border px-4 text-sm font-bold " + (i === j ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}
          >
            {x.days === 365 ? "Year" : `${x.days} days`}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Channel</th>
              <th className="px-3 py-2 text-right font-semibold">Leads</th>
              <th className="px-3 py-2 text-right font-semibold">Sold</th>
              <th className="px-3 py-2 text-right font-semibold">Revenue</th>
              <th className="px-3 py-2 text-right font-semibold">Spend</th>
              <th className="px-3 py-2 text-right font-semibold">Per lead</th>
              <th className="px-3 py-2 text-right font-semibold">Per client</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                  No leads in this period.
                </td>
              </tr>
            )}
            {p.lines.map((l) => (
              <tr key={l.label} className="border-t">
                <td className="px-3 py-2 font-medium">{l.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.leads}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.sold}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.revenueCents)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.spendCents ? money(l.spendCents) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.costPerLeadCents)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.cacCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2">All channels</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.leads}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.sold}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(p.revenueCents)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(p.spendCents)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.spendCents && p.leads ? money(Math.round(p.spendCents / p.leads)) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.spendCents && p.sold ? money(Math.round(p.spendCents / p.sold)) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!hasSpend && <p className="text-xs text-muted-foreground">No spend recorded yet: connect Google Ads or upload a CSV below, and close plays to cost hangers and flyers.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Google

export function GoogleRunButton({ disabled }: { disabled?: boolean }) {
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const r = await runGoogleNow();
            setNote(r.ok ? { text: r.value } : { text: r.error, error: true });
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Pull from Google now
      </button>
      {note && <Message text={note.text} error={note.error} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spend

export function SpendForms() {
  const [channel, setChannel] = useState<string>("google_ads");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setNote(null);
    start(async () => {
      const text = await file.text();
      const r = await uploadSpendCsv(text, channel);
      setNote(r.ok ? { text: `${r.value.rows} day${r.value.rows === 1 ? "" : "s"} of spend saved.${r.value.problems.length ? ` ${r.value.problems.length} lines skipped.` : ""}` } : { text: r.error, error: true });
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="grid gap-3 text-sm">
      <label className="grid gap-1">
        <span className="font-medium">Channel</span>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="min-h-11 rounded-md border bg-background px-2.5">
          {SPEND_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {SPEND_CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className={btn + " cursor-pointer"}>
          <Upload className="h-4 w-4" /> Upload a CSV
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
        </label>
        <span className="text-xs text-muted-foreground">Needs a date column and a cost column; a channel column is optional.</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="grid gap-1">
          <span className="font-medium">Or one amount: date</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="min-h-11 rounded-md border bg-background px-2.5" />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Amount ($)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11 rounded-md border bg-background px-2.5" />
        </label>
        <button
          type="button"
          className={btn}
          disabled={pending || !amount}
          onClick={() =>
            start(async () => {
              const r = await addManualSpend({ channel, day, amount: Number(amount) });
              setNote(r.ok ? { text: "Saved." } : { text: r.error, error: true });
              if (r.ok) setAmount("");
            })
          }
        >
          Add
        </button>
      </div>
      {note && <Message text={note.text} error={note.error} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seasonal email

export function SeasonCard({ season, open, run }: { season: Season; open: boolean; run: { status: string; sent: number; audience: number } | null }) {
  const info = SEASON_INFO[season];
  const [preview, setPreview] = useState<SeasonPreview | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{info.label}</span>
        <span className="text-xs text-muted-foreground">
          {run ? (run.status === "done" ? `Sent ${run.sent} of ${run.audience}` : `Sending: ${run.sent} of ${run.audience} so far`) : open ? "Window open now" : `Opens ${info.opens[0]}/${info.opens[1]}`}
        </span>
      </div>
      {!run && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await previewSeasonal(season);
                if (r.ok) setPreview(r.value);
                else setNote({ text: r.error, error: true });
              })
            }
          >
            Preview
          </button>
          {preview && preview.audience > 0 && (
            <button
              type="button"
              className={primary}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await startSeasonal(season);
                  setNote(r.ok ? { text: "Started. It sends in daily batches through the usual consent and approval checks." } : { text: r.error, error: true });
                })
              }
            >
              <Play className="h-4 w-4" /> Start sending to {preview.audience}
            </button>
          )}
        </div>
      )}
      {preview && (
        <div className="grid gap-1.5 rounded-lg bg-muted/40 p-2.5">
          <p>
            Goes to <b>{preview.audience}</b> past client{preview.audience === 1 ? "" : "s"}
            {preview.excluded.length > 0 && <> (left out: {preview.excluded.map((e) => `${e.count} ${e.reason}`).join(", ")})</>}. Only those who agreed to marketing email receive it.
          </p>
          {preview.sample && (
            <div className="rounded-md border bg-background p-2.5">
              <p className="font-semibold">{preview.sample.subject}</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{preview.sample.body}</p>
            </div>
          )}
        </div>
      )}
      {note && <Message text={note.text} error={note.error} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews

export function HeldReplyCard({ id, draft, error }: { id: string; draft: string; error: string | null }) {
  const [text, setText] = useState(draft);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(error);
  const [pending, start] = useTransition();
  if (done) return <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> {done}</p>;
  return (
    <div className="grid gap-2">
      <textarea aria-label="Reply" rows={4} value={text} onChange={(e) => setText(e.target.value)} className="rounded-md border bg-background px-2.5 py-1.5 text-sm" />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={pending || text.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await approveReviewReply(id, text);
              if (r.ok) setDone("Posted on Google.");
              else setNote(r.error);
            })
          }
        >
          Post reply
        </button>
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await skipReviewReply(id);
              if (r.ok) setDone("Left without a reply.");
              else setNote(r.error);
            })
          }
        >
          Don&apos;t reply
        </button>
      </div>
      <Message text={note} error />
    </div>
  );
}

export function DraftReplyButton({ id }: { id: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (draft) return <HeldReplyCard id={id} draft={draft} error={null} />;
  return (
    <div className="grid gap-1">
      <button
        type="button"
        className={btn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await draftReplyNow(id);
            if (r.ok) setDraft(r.value);
            else setNote(r.error);
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Draft a reply
      </button>
      <Message text={note} error />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plays

export function PlayActions({
  playId,
  assignedTo,
  people,
  open,
}: {
  playId: string;
  assignedTo: string | null;
  people: { id: string; name: string; affiliate: boolean }[];
  open: boolean;
}) {
  const [who, setWho] = useState(assignedTo ?? "");
  const [state, setState] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (state) return <p className="text-sm text-muted-foreground">{state}</p>;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Assign to"
          value={who}
          disabled={pending || !open}
          onChange={(e) => {
            const next = e.target.value;
            setWho(next);
            start(async () => {
              const r = await assignPlayTo(playId, next || null);
              if (!r.ok) setNote(r.error);
            });
          }}
          className="min-h-11 max-w-[14rem] rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.affiliate ? " (affiliate)" : ""}
            </option>
          ))}
        </select>
        {open && (
          <>
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await markPlayDone(playId);
                  if (r.ok) setState("Done.");
                  else setNote(r.error);
                })
              }
            >
              Done
            </button>
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await skipPlay(playId);
                  if (r.ok) setState("Skipped.");
                  else setNote(r.error);
                })
              }
            >
              Skip
            </button>
          </>
        )}
      </div>
      <Message text={note} error />
    </div>
  );
}

export function ExpireBacklogButton({ days, count }: { days: number; count: number }) {
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={pending || count === 0}
        onClick={() =>
          start(async () => {
            const r = await expireStalePlays();
            setNote(r.ok ? { text: `${r.value} old play${r.value === 1 ? "" : "s"} expired with a note.` } : { text: r.error, error: true });
          })
        }
      >
        Clear out {count} play{count === 1 ? "" : "s"} untouched for {days}+ days
      </button>
      {note && <Message text={note.text} error={note.error} />}
    </div>
  );
}

/**
 * "Walk this round": while on, the phone's position goes on the round's
 * trail every half a minute, and the round closes itself once the trail has
 * passed most of its doors. Only works with the page open, as a browser
 * cannot report from a pocket, and says so.
 */
export function WalkTracker({ playId }: { playId: string }) {
  const [on, setOn] = useState(false);
  const [sent, setSent] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const buffer = useRef<{ lat: number; lng: number; accuracy: number | null; at: string }[]>([]);

  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => buffer.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, at: new Date(pos.timestamp).toISOString() }),
      () => setNote("Location is off for this site; the walk can't be recorded."),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );
    const flush = async () => {
      const points = buffer.current.splice(0, buffer.current.length);
      if (points.length === 0) return;
      const r = await recordPlayTrail(playId, points);
      if (r.ok) setSent((n) => n + r.value);
      else setNote(r.error);
    };
    const timer = setInterval(() => void flush(), 30_000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
      void flush();
    };
  }, [on, playId]);

  return (
    <div className="grid gap-1">
      <button type="button" className={on ? primary : btn} onClick={() => setOn((v) => !v)}>
        {on ? <Square className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} {on ? "Stop walking" : "Walk this round"}
      </button>
      {on && <p className="text-xs text-muted-foreground">Recording the walk ({sent} points sent). Keep this page open.</p>}
      <Message text={note} error />
    </div>
  );
}
