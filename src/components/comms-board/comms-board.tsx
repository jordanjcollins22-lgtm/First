"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Inbox, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChipRow } from "@/components/ui/chip-row";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  CHANNEL_GROUPS,
  CHANNELS,
  HAND_CHANNELS,
  LANES,
  NO_REASONS,
  cardsIn,
  inGroup,
  oneInValidate,
  replyCheck,
  type BoardCard,
  type CardState,
  type Lane,
} from "@/lib/comms-board";
import { INTENTS } from "@/lib/comms-intents";
import { buildSections, type PersonRaw, type Section } from "@/lib/comms-person";

export type ApiResult<T> = { ok: true; value: T; saved: boolean } | { ok: false; error: string };

export interface NewMessage {
  customerId: string | null;
  name: string;
  phone: string;
  email: string;
  channel: string;
  body: string;
  at: string | null;
}

/** What the board does. The live page passes the server actions; the review page passes a sample that saves nothing. */
export interface BoardApi {
  loadRecord(card: BoardCard): Promise<PersonRaw | null>;
  start(key: string): Promise<ApiResult<CardState>>;
  breakdown(key: string): Promise<ApiResult<CardState>>;
  draft(key: string): Promise<ApiResult<CardState>>;
  answer(key: string, text: string): Promise<ApiResult<CardState>>;
  no(key: string, picked: string[], typed: string): Promise<ApiResult<CardState>>;
  yes(key: string, message: string, byHand?: boolean): Promise<ApiResult<CardState & { note: string | null }>>;
  park(key: string, followUpOn: string | null): Promise<ApiResult<CardState>>;
  addMessage(input: NewMessage): Promise<ApiResult<{ id: string }>>;
  findContacts(q: string): Promise<{ id: string; name: string; phone: string | null; email: string | null }[]>;
}

const when = (iso: string, today: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return day === today
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
};

const tone = {
  alert: "border-transparent bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  wait: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  ok: "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  info: "border-transparent bg-lime-100 text-lime-900 dark:bg-lime-950/40 dark:text-lime-200",
};

export function CommsBoard({
  initialCards,
  api,
  today,
  needsMigration = false,
  sample = false,
}: {
  initialCards: BoardCard[];
  api: BoardApi;
  today: string;
  needsMigration?: boolean;
  sample?: boolean;
}) {
  const [cards, setCards] = useState<BoardCard[]>(() => oneInValidate(initialCards));
  const [group, setGroup] = useState<string>("All");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(needsMigration);
  const [adding, setAdding] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A refresh from the server (a new message arrived) replaces the cards.
  const [seen, setSeen] = useState(initialCards);
  if (seen !== initialCards) {
    setSeen(initialCards);
    setCards(oneInValidate(initialCards));
  }

  const say = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const merge = (key: string, state: CardState, extra: Partial<BoardCard> = {}) =>
    setCards((all) =>
      oneInValidate(all.map((c) => (c.personKey === key ? { ...c, ...state, person: c.person, restarted: false, repliedElsewhere: false, ready: state.lane === "doing" && Boolean(state.draft), ...extra } : c)))
    );

  const run = async (key: string, work: () => Promise<ApiResult<CardState>>, ok?: (s: CardState) => void) => {
    setBusy(key);
    try {
      const r = await work();
      if (!r.ok) {
        setFailed((f) => ({ ...f, [key]: r.error }));
        say(r.error);
        return false;
      }
      if (!r.saved) setUnsaved(true);
      setFailed((f) => {
        const next = { ...f };
        delete next[key];
        return next;
      });
      merge(key, r.value);
      ok?.(r.value);
      return true;
    } finally {
      setBusy(null);
    }
  };

  // Claude works one card at a time: Breakdown first, then the draft.
  const next = useMemo(() => {
    const todo = cards.find((c) => c.lane === "breakdown" && !failed[c.personKey]) ?? cards.find((c) => c.lane === "doing" && !c.draft && !failed[c.personKey]);
    return todo ? { key: todo.personKey, step: todo.lane === "breakdown" ? "breakdown" : "draft" } : null;
  }, [cards, failed]);
  useEffect(() => {
    if (busy || !next) return;
    const t = setTimeout(() => void run(next.key, () => (next.step === "breakdown" ? api.breakdown(next.key) : api.draft(next.key))), 0);
    return () => clearTimeout(t);
    // run is recreated each render; next and busy are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, busy]);

  const counts = Object.fromEntries(CHANNEL_GROUPS.map((g) => [g, cards.filter((c) => inGroup(c, g)).length]));
  const open = cards.find((c) => c.personKey === openKey) ?? null;
  const backlog = cardsIn(cards, "backlog", group);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">Communications Board</h1>
            {sample && <Badge className={tone.wait}>Sample messages</Badge>}
          </div>
          {unsaved && !sample && (
            <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-300">Needs update 0373 to save lanes, drafts and added messages. The cards below are worked out from the messages.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!sample && (
            <Button asChild variant="outline" size="sm">
              <Link href="/conversations">
                <Inbox className="h-4 w-4" /> Inbox
              </Link>
            </Button>
          )}
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add a message
          </Button>
        </div>
      </header>

      <div id="cb-chips" role="group" aria-label="Filter by where it came from">
        <ChipRow
          options={CHANNEL_GROUPS.filter((g) => g === "All" || counts[g] > 0).map((g) => ({ value: g, label: g, count: counts[g] }))}
          value={group}
          onChange={setGroup}
        />
      </div>

      <main id="cb-board" className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(6,minmax(230px,1fr))] md:overflow-x-auto md:pb-2">
        {LANES.map((lane) => {
          const list = cardsIn(cards, lane.id, group);
          return (
            <section key={lane.id} id={lane.id === "backlog" ? "cb-backlog" : `cb-lane-${lane.id}`} aria-label={lane.name} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/50 p-2.5">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                {lane.name}
                <span className="rounded-full border border-border bg-card px-1.5 font-mono text-[11px] font-medium text-muted-foreground">{list.length}</span>
                {lane.limit && <span className="ml-auto font-mono text-[10px] normal-case text-amber-700 dark:text-amber-300">{lane.limit} at a time</span>}
                {lane.id === "backlog" && backlog.length > 0 && (
                  <button
                    type="button"
                    className="ml-auto text-[11px] font-semibold normal-case text-primary disabled:opacity-50"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      for (const c of backlog) await run(c.personKey, () => api.start(c.personKey));
                    }}
                  >
                    Start all
                  </button>
                )}
              </h2>
              <div className="flex flex-col gap-2">
                {lane.id === "validate" && list[0] ? (
                  <>
                    <ValidatePanel
                      card={list[0]}
                      today={today}
                      busy={busy === list[0].personKey}
                      onOpen={() => setOpenKey(list[0].personKey)}
                      onYes={async (message, byHand) => {
                        setBusy(list[0].personKey);
                        try {
                          const r = await api.yes(list[0].personKey, message, byHand);
                          if (!r.ok) return r.error;
                          if (!r.saved) setUnsaved(true);
                          merge(list[0].personKey, r.value);
                          say(r.value.note ?? (r.value.sent?.did ? `${r.value.sent.did}. Sent to ${list[0].person.name}.` : `Sent to ${list[0].person.name}.`));
                          return null;
                        } finally {
                          setBusy(null);
                        }
                      }}
                      onNo={async (picked, typed) => {
                        const r = await api.no(list[0].personKey, picked, typed);
                        if (!r.ok) return r.error;
                        if (!r.saved) setUnsaved(true);
                        merge(list[0].personKey, r.value);
                        say(`Back to Claude: ${r.value.noReasons?.at(-1)?.why ?? ""}`);
                        return null;
                      }}
                    />
                    {list.length > 1 && <p className="text-xs text-muted-foreground">{list.length - 1} more waiting their turn</p>}
                  </>
                ) : list.length ? (
                  list.map((c) => (
                    <div key={c.personKey} className="flex flex-col gap-1.5">
                      <CardButton card={c} today={today} working={busy === c.personKey} error={failed[c.personKey]} onOpen={() => setOpenKey(c.personKey)} />
                      {lane.id === "track" && c.question && !c.answer && (
                        <QuestionBlock card={c} busy={busy === c.personKey} onAnswer={(text) => run(c.personKey, () => api.answer(c.personKey, text))} />
                      )}
                      {lane.id === "done" && c.sent?.byHand && c.sent.body && <CopyButton text={c.sent.body} />}
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Nothing here</p>
                )}
              </div>
            </section>
          );
        })}
      </main>

      {open && (
        <PersonDrawer
          card={open}
          api={api}
          today={today}
          busy={busy === open.personKey}
          onClose={() => setOpenKey(null)}
          onStart={() => run(open.personKey, () => api.start(open.personKey))}
          onPark={(d) => run(open.personKey, () => api.park(open.personKey, d), () => say(`Parked in Answer · Track${d ? ` until ${d}` : ""}.`))}
          onAnswer={(text) => run(open.personKey, () => api.answer(open.personKey, text))}
        />
      )}

      {adding && (
        <AddMessage
          api={api}
          onClose={() => setAdding(false)}
          onAdded={(saved) => {
            setAdding(false);
            if (!saved) setUnsaved(true);
            say("Added. It joins that person's card.");
          }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function ChannelBadges({ card }: { card: BoardCard }) {
  const labels = [...new Set(card.person.messages.map((m) => CHANNELS[m.channel].label))];
  return (
    <>
      {labels.map((l) => (
        <Badge key={l} variant="outline" className="px-2 py-0 text-[11px] font-medium text-muted-foreground">
          {l}
        </Badge>
      ))}
    </>
  );
}

function CardButton({ card, today, working, error, onOpen }: { card: BoardCard; today: string; working: boolean; error?: string; onOpen: () => void }) {
  const last = card.person.messages[card.person.messages.length - 1];
  const check = replyCheck(card.person.messages);
  const flags: { text: string; cls: string }[] = [];
  if (card.restarted) flags.push({ text: "New message, redoing", cls: tone.alert });
  if (card.repliedElsewhere) flags.push({ text: "Already replied", cls: tone.ok });
  if (check.unread.length > 1 && card.lane !== "done") flags.push({ text: `${check.unread.length} unanswered`, cls: tone.info });
  if (card.intent && card.lane !== "done") flags.push({ text: INTENTS[card.intent], cls: tone.info });
  if (working) flags.push({ text: card.lane === "breakdown" ? "Breaking down…" : "Writing…", cls: tone.wait });
  if (card.ready) flags.push({ text: "Ready, waiting its turn", cls: tone.ok });
  if (card.lane === "track" && card.question && !card.answer) flags.push({ text: "Needs your answer", cls: tone.alert });
  else if (card.lane === "track") flags.push({ text: card.followUpOn ? `Follow up ${card.followUpOn}` : "Waiting on them", cls: tone.wait });
  if (card.lane === "done") flags.push(card.sent?.byHand ? { text: "Reply by hand", cls: tone.wait } : { text: card.action?.kind === "no_reply" ? "No reply" : "Sent", cls: tone.ok });
  if (error) flags.push({ text: "Stuck: open it", cls: tone.alert });
  const shown = card.lane === "done" && card.sent ? card.sent.did || card.sent.body || last?.text : last?.text;

  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-left shadow-sm hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex items-center gap-2">
        <ContactAvatar name={card.person.name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{card.person.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{last ? when(last.at, today) : ""}</span>
      </span>
      <span className="line-clamp-2 text-[13px]">{card.lane === "done" && card.sent?.body ? `We said: ${card.sent.body}` : shown}</span>
      <span className="flex flex-wrap gap-1">
        <ChannelBadges card={card} />
        {flags.map((f) => (
          <Badge key={f.text} className={`px-2 py-0 text-[11px] ${f.cls}`}>
            {f.text}
          </Badge>
        ))}
      </span>
    </button>
  );
}

function QuestionBlock({ card, busy, onAnswer }: { card: BoardCard; busy: boolean; onAnswer: (text: string) => void }) {
  const [other, setOther] = useState("");
  if (!card.question) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border-2 border-amber-400 bg-card p-2.5">
      <p className="text-[13px] font-semibold">{card.question.text}</p>
      <div className="flex flex-wrap gap-1">
        {card.question.options.map((o) => (
          <button key={o} type="button" disabled={busy} onClick={() => onAnswer(o)} className="rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:border-primary disabled:opacity-50">
            {o}
          </button>
        ))}
      </div>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (other.trim()) onAnswer(other.trim());
        }}
      >
        <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other" className="h-8 text-xs" aria-label={`Other answer for ${card.person.name}`} />
        <Button type="submit" size="sm" className="h-8" disabled={busy || !other.trim()}>
          Answer
        </Button>
      </form>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 self-start text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // No clipboard: the text is on the card to select by hand.
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy the reply"}
    </Button>
  );
}

function Resources({ card }: { card: BoardCard }) {
  if (!card.resources?.length) return null;
  return (
    <div id="cb-resources" className="flex flex-col gap-1.5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Look at</p>
      {card.resources.map((r) => (
        <div key={`${r.label}${r.href}`} className="rounded-lg border border-border bg-background/60 p-2 text-[13px]">
          <a href={r.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-primary hover:underline">
            {r.label} <ExternalLink className="h-3 w-3" />
          </a>
          {r.highlight && <mark className="mt-1 block rounded bg-amber-200/80 px-1.5 py-0.5 text-foreground dark:bg-amber-500/30">{r.highlight}</mark>}
          {r.lines?.length ? (
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
              {r.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ValidatePanel({
  card,
  today,
  busy,
  onOpen,
  onYes,
  onNo,
}: {
  card: BoardCard;
  today: string;
  busy: boolean;
  onOpen: () => void;
  onYes: (message: string, byHand?: boolean) => Promise<string | null>;
  onNo: (picked: string[], typed: string) => Promise<string | null>;
}) {
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(card.draft ?? "");
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState(card.personKey + (card.draft ?? ""));
  if (lastKey !== card.personKey + (card.draft ?? "")) {
    setLastKey(card.personKey + (card.draft ?? ""));
    setMessage(card.draft ?? "");
    setAsking(false);
    setPicked([]);
    setTyped("");
    setError(null);
    setEditing(false);
  }
  const check = replyCheck(card.person.messages);
  const said = check.unread.length ? check.unread : card.person.messages.filter((m) => m.direction === "in").slice(-2);
  const channel = card.draftChannel ? CHANNELS[card.draftChannel].label : "";
  const noReply = card.action?.kind === "no_reply";

  return (
    <div id="cb-validate" className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <ContactAvatar name={card.person.name} size="sm" />
        <p className="min-w-0 flex-1 truncate font-semibold">{card.person.name}</p>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onOpen}>
          History
        </Button>
      </div>

      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">What they said</p>
        <div className="flex flex-col gap-1.5">
          {said.map((m) => (
            <p key={m.id} className="rounded-xl bg-muted px-2.5 py-1.5 text-[13px]">
              <b>{CHANNELS[m.channel].label}</b> <span className="font-mono text-[11px] text-muted-foreground">{when(m.at, today)}</span>
              <br />
              {m.text}
            </p>
          ))}
        </div>
      </div>

      {card.intent && (
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">What they want</p>
          <p className="text-[13px]">
            <b>{INTENTS[card.intent]}</b>
            {card.intentSummary ? `: ${card.intentSummary}` : ""}
          </p>
        </div>
      )}

      <Resources card={card} />

      {card.action && (
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">We&apos;ll do</p>
          <p className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[13px] font-semibold">{card.action.label}</p>
        </div>
      )}

      {!noReply && (
        <div>
          <p className="mb-1 flex items-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            We&apos;ll say · by {channel}
            {card.draftByHand ? " (reply by hand)" : ""}
            <button type="button" className="ml-auto font-sans text-[11px] normal-case tracking-normal text-primary" onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit"}
            </button>
          </p>
          {editing ? (
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="text-[13px]" aria-label="The message" />
          ) : (
            <p className="rounded-xl bg-lime-100 px-2.5 py-1.5 text-[13px] dark:bg-lime-950/40">{message}</p>
          )}
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <p>{error}</p>
          {!noReply && (
            <Button size="sm" variant="outline" className="h-7 self-start text-xs" disabled={busy} onClick={async () => setError(await onYes(message, true))}>
              Reply by hand instead
            </Button>
          )}
        </div>
      )}

      {asking ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Why not?</p>
          <div className="flex flex-wrap gap-1">
            {NO_REASONS.map((r) => {
              const on = picked.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== r) : [...picked, r])}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-transparent bg-foreground text-background" : "border-border"}`}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} rows={2} placeholder="Or type it" className="text-[13px]" aria-label="Why not" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
              Back
            </Button>
            <Button className="flex-1" disabled={busy || (!picked.length && !typed.trim())} onClick={async () => setError(await onNo(picked, typed))}>
              Send No
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy || (!noReply && !message.trim())} onClick={async () => setError(await onYes(message))}>
            {busy ? "Sending…" : noReply ? "Yes, no reply" : "Yes, send it"}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setAsking(true)}>
            No
          </Button>
        </div>
      )}
    </div>
  );
}

function PersonDrawer({
  card,
  api,
  today,
  busy,
  onClose,
  onStart,
  onPark,
  onAnswer,
}: {
  card: BoardCard;
  api: BoardApi;
  today: string;
  busy: boolean;
  onClose: () => void;
  onStart: () => void;
  onPark: (followUpOn: string | null) => void;
  onAnswer: (text: string) => void;
}) {
  const [raw, setRaw] = useState<PersonRaw | null | "loading">("loading");
  const [followUp, setFollowUp] = useState("");
  useEffect(() => {
    let live = true;
    api.loadRecord(card).then(
      (r) => live && setRaw(r),
      () => live && setRaw(null)
    );
    return () => {
      live = false;
    };
    // Loaded once per person opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.personKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections: Section[] | null = raw && raw !== "loading" ? buildSections(raw, card.person, today, { question: card.question && !card.answer ? card.question.text : null }) : null;
  const lane: Lane = card.lane;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside aria-label={card.person.name} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <ContactAvatar name={card.person.name} size="md" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold">{card.person.name}</h3>
            <p className="text-xs text-muted-foreground">{LANES.find((l) => l.id === lane)?.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {lane === "backlog" && (
            <Button size="sm" disabled={busy} onClick={onStart}>
              Start: break it down
            </Button>
          )}
          {lane !== "done" && lane !== "validate" && (
            <span className="flex items-center gap-1">
              <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="h-9 w-[150px] text-xs" aria-label="Follow up on" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onPark(followUp || null)}>
                Park in Track
              </Button>
            </span>
          )}
        </div>

        {card.question && !card.answer && <QuestionBlock card={card} busy={busy} onAnswer={onAnswer} />}

        {card.intent && (
          <section className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Breakdown</h4>
            <p className="text-sm">
              <b>{INTENTS[card.intent]}</b>
              {card.intentSummary ? `: ${card.intentSummary}` : ""}
            </p>
            <Resources card={{ ...card, resources: card.resources }} />
            {card.action && <p className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[13px] font-semibold">{card.action.label}</p>}
            {card.draft && <p className="rounded-xl bg-lime-100 px-2.5 py-1.5 text-[13px] dark:bg-lime-950/40">{card.draft}</p>}
            {card.noReasons?.length ? <p className="text-xs text-muted-foreground">Said no before: {card.noReasons.map((n) => n.why).join("; ")}</p> : null}
          </section>
        )}
        {card.sent && (
          <section className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Sent{card.sent.byHand ? " · reply by hand" : ""}</h4>
            {card.sent.did && <p className="text-sm font-semibold">{card.sent.did}</p>}
            {card.sent.body && <p className="rounded-xl bg-lime-100 px-2.5 py-1.5 text-[13px] dark:bg-lime-950/40">{card.sent.body}</p>}
            {card.sent.byHand && card.sent.body && <CopyButton text={card.sent.body} />}
          </section>
        )}

        {raw === "loading" && <p className="text-sm text-muted-foreground">Gathering contact, property and history…</p>}
        {raw === null && <p className="text-sm text-destructive">Couldn&apos;t load their record.</p>}
        {sections?.map((s) => (
          <section key={s.id} id={`cb-person-${s.id}`} className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h4 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {s.title}
              <span className="rounded-full border border-border px-1.5 text-[10px]">{s.count}</span>
              {s.href && (
                <a href={s.href} target="_blank" rel="noreferrer" className="ml-auto font-sans text-[11px] normal-case tracking-normal text-primary hover:underline">
                  Open
                </a>
              )}
            </h4>
            {s.summary && <p className="text-sm font-semibold">{s.summary}</p>}
            {s.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {s.items.map((it, i) => (
                  <li key={`${it.label}${i}`} className="flex gap-2 text-[13px]">
                    <span className={`shrink-0 font-medium ${it.tone === "alert" ? "text-red-700 dark:text-red-300" : it.tone === "wait" ? "text-amber-700 dark:text-amber-300" : it.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                      {it.href ? (
                        <a href={it.href} target="_blank" rel="noreferrer" className="hover:underline">
                          {it.label}
                        </a>
                      ) : (
                        it.label
                      )}
                    </span>
                    {it.detail && <span className="min-w-0 text-muted-foreground">{it.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </aside>
    </>
  );
}

function AddMessage({ api, onClose, onAdded }: { api: BoardApi; onClose: () => void; onAdded: (saved: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ id: string; name: string; phone: string | null; email: string | null }[]>([]);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState("mail");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (who || query.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => api.findContacts(query).then((r) => live && setMatches(r)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, who, api]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label="Add a message" className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(440px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-2xl">
        <div className="flex items-center">
          <h3 className="flex-1 text-lg font-bold">Add a message</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Who
          {who ? (
            <span className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <span className="flex-1">{who.name}</span>
              <button type="button" className="text-xs text-primary" onClick={() => setWho(null)}>
                Change
              </button>
            </span>
          ) : (
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts, or fill in a new one below" />
          )}
        </label>
        {!who && matches.length > 0 && query.trim().length >= 2 && (
          <ul className="flex flex-col rounded-md border border-border">
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent/40" onClick={() => setWho({ id: m.id, name: m.name })}>
                  {m.name} <span className="text-xs text-muted-foreground">{m.phone ?? m.email ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!who && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New contact name" aria-label="Name" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" aria-label="Phone" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" />
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Where it came from
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm">
            {HAND_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNELS[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          What they said
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={pending || !body.trim()}
          onClick={async () => {
            setPending(true);
            setError(null);
            const r = await api.addMessage({ customerId: who?.id ?? null, name: who?.name ?? name, phone, email, channel, body, at: null });
            setPending(false);
            if (!r.ok) setError(r.error);
            else onAdded(r.saved);
          }}
        >
          Add to their card
        </Button>
      </div>
    </>
  );
}
