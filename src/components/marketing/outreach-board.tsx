"use client";

import { createContext, useContext, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";
import {
  bookingRate,
  clickRate,
  groupKey,
  kindLabel,
  goesToOnePerson,
  platformLabel,
  RESPONSES,
  responseLabel,
  type Funnel,
  type GroupTally,
  type OutreachResponse,
} from "@/lib/outreach-links";
import { recordResponse } from "@/lib/actions/outreach-link-actions";
import { recordCommissionPaid } from "@/lib/actions/commission-actions";
import { updateCustomerContact } from "@/lib/actions/customer-actions";
import { CopyButton } from "@/components/groups/copy-button";
import { Button } from "@/components/ui/button";
import type { OutreachBoard, OutreachBooking, OutreachListRow } from "@/lib/data/outreach-links";
import type { PersonStanding } from "@/lib/outreach-links";
import { postedVersion, VERSION_LABEL } from "@/lib/posted-comment";

/**
 * What came of every link handed out.
 *
 * Four numbers in the order they happen, and that order is the whole point.
 * Handed out, opened, answered, booked. A room that never opens anything and a
 * room that opens everything and books nobody are different problems needing
 * opposite decisions, and bookings alone cannot tell them apart.
 *
 * Every number opens. A room opens to its comments and to the people who
 * booked from it; a comment opens to the people who booked from that one
 * comment, with their contact details there to ring and there to correct.
 */
/** Whether the person reading may mark a commission paid: the owner's board only. */
const CanPayContext = createContext(false);

export function OutreachBoardView({ board, scope = "everyone" }: { board: OutreachBoard; scope?: "everyone" | "mine" }) {
  const [tab, setTab] = useState<"rooms" | "recent" | "people" | "how">("rooms");
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  // Who posted what, and who converted, is the owner's table. A person
  // reading their own board has one row on it, which says nothing.
  const tabs = [
    { key: "rooms" as const, label: "Rooms" },
    { key: "recent" as const, label: scope === "mine" ? "My links" : "Every link" },
    { key: "people" as const, label: "Leaderboard" },
    { key: "how" as const, label: "What works" },
  ];

  const room = openRoom ? board.groups.find((g) => g.key === openRoom) ?? null : null;

  return (
    <CanPayContext.Provider value={scope === "everyone"}>
    <div className="flex flex-col gap-4">
      <FunnelBar funnel={board.total} />

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setTab(option.key)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs",
              tab === option.key
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === "rooms" && (
        <>
          <Table
            caption="Where a link landed. Ordered by bookings, because one booking from twenty beats a perfect record from one. Tap a room to see every comment in it and who booked."
            rows={board.groups.map((group) => ({
              key: group.key,
              name: group.audience,
              detail: platformLabel(group.platform),
              funnel: group,
            }))}
            selected={openRoom}
            onSelect={(key) => setOpenRoom(openRoom === key ? null : key)}
          />
          {room && <RoomDetail room={room} board={board} onClose={() => setOpenRoom(null)} />}
        </>
      )}

      {tab === "people" && (
        <>
          <Leaderboard
            standings={board.standings}
            showMoney={scope === "everyone"}
            // Everybody sees the ranking; only the owner opens another person's
            // comments. Your own row opens for you.
            canOpen={(id) => scope === "everyone" || board.rows.some((row) => row.profileId === id)}
            selected={openPerson}
            onSelect={(id) => setOpenPerson(openPerson === id ? null : id)}
          />
          {openPerson && (
            <PersonDetail
              standing={board.standings.find((p) => p.profileId === openPerson) ?? null}
              board={board}
              onClose={() => setOpenPerson(null)}
            />
          )}
        </>
      )}

      {tab === "how" && (
        <>
          <Table
            caption="A post reaches a room and a comment reaches a person, so they are counted apart. This is where the next hour goes."
            rows={board.kinds.map((entry) => ({
              key: entry.kind,
              name: kindLabel(entry.kind),
              detail: null,
              funnel: entry,
            }))}
          />
          {board.pages.length > 0 && (
            <Table
              caption="Our own pages and accounts, for posts that named one."
              rows={board.pages.map((entry) => ({
                key: entry.page,
                name: entry.page,
                detail: null,
                funnel: entry,
              }))}
            />
          )}
        </>
      )}

      {tab === "recent" && <LinkList rows={board.rows} bookingsByCode={board.bookingsByCode} />}
    </div>
    </CanPayContext.Provider>
  );
}

/** The four numbers, once, across the top. */
function FunnelBar({ funnel }: { funnel: Funnel }) {
  const steps = [
    { label: "Handed out", value: funnel.posts, detail: null },
    {
      label: "Opened",
      value: funnel.clicked,
      detail: funnel.clicks > funnel.clicked ? `${funnel.clicks} opens` : null,
    },
    { label: "Answered", value: funnel.replied, detail: null },
    { label: "Booked", value: funnel.bookings, detail: null },
  ];

  return (
    <div className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border">
      {steps.map((step) => (
        <div key={step.label} className="px-2 py-3 text-center">
          <p className="text-xl font-bold tabular-nums sm:text-2xl">{step.value}</p>
          <p className="text-[11px] text-muted-foreground">{step.label}</p>
          {step.detail && <p className="text-[10px] text-muted-foreground">{step.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function Table({
  caption,
  rows,
  selected,
  onSelect,
}: {
  caption: string;
  rows: { key: string; name: string; detail: string | null; funnel: Funnel }[];
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Nothing here yet.</p>;
  }

  return (
    <section className="rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{caption}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="p-2 font-medium">Where</th>
              <th className="p-2 text-right font-medium">Sent</th>
              <th className="p-2 text-right font-medium">Opened</th>
              <th className="p-2 text-right font-medium">Answered</th>
              <th className="p-2 text-right font-medium">Booked</th>
              <th className="p-2 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const opens = clickRate(row.funnel);
              const books = bookingRate(row.funnel);
              const isOpen = selected === row.key;
              return (
                <tr
                  key={row.key}
                  onClick={onSelect ? () => onSelect(row.key) : undefined}
                  className={cn(
                    "border-b border-border last:border-0",
                    onSelect && "cursor-pointer hover:bg-accent/40",
                    isOpen && "bg-primary/5"
                  )}
                >
                  <td className="p-2">
                    {onSelect ? (
                      <span className="inline-flex items-center gap-1">
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="font-medium">{row.name}</span>
                      </span>
                    ) : (
                      <span className="font-medium">{row.name}</span>
                    )}
                    {row.detail && <span className="ml-1.5 text-xs text-muted-foreground">{row.detail}</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{row.funnel.posts}</td>
                  <td className="p-2 text-right tabular-nums">
                    {row.funnel.clicked}
                    {opens != null && (
                      <span className="ml-1 text-xs text-muted-foreground">{Math.round(opens * 100)}%</span>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">{row.funnel.replied}</td>
                  <td className="p-2 text-right tabular-nums">{row.funnel.bookings}</td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">
                    {/* Withheld below a handful. A rate on one link is not a
                        rate, and a made-up 100% is the number somebody acts on. */}
                    {books == null ? "—" : `${Math.round(books * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Everyone who posted, best first.
 *
 * Closed is the column that matters and the one the rank is built on: a
 * booking that became a paid job. The rest is how they got there, so a
 * person with plenty of opens and no bookings can be told to change the
 * words, and a person with no opens can be told to change the room.
 */
function Leaderboard({
  standings,
  showMoney,
  canOpen,
  selected,
  onSelect,
}: {
  standings: PersonStanding[];
  /** Collected and commission columns: the owner's, not the room's. */
  showMoney: boolean;
  canOpen: (profileId: string) => boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (standings.length === 0) {
    return <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Nobody has posted yet.</p>;
  }
  return (
    <section className="rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        Ranked by jobs closed, then bookings, then opens.{showMoney ? " Tap a name for every comment and message they answered." : " Tap your own name for your comments and messages."}
      </p>
      <div className="overflow-x-auto">
        <table className={cn("w-full border-collapse text-sm", showMoney ? "min-w-[720px]" : "min-w-[560px]")}>
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="p-2 font-medium">#</th>
              <th className="p-2 font-medium">Who</th>
              <th className="p-2 text-right font-medium">Comments</th>
              <th className="p-2 text-right font-medium">DMs</th>
              <th className="p-2 text-right font-medium">Opened</th>
              <th className="p-2 text-right font-medium">Answered</th>
              <th className="p-2 text-right font-medium">Booked</th>
              <th className="p-2 text-right font-medium">Closed</th>
              {showMoney && <th className="p-2 text-right font-medium">Collected</th>}
              {showMoney && <th className="p-2 text-right font-medium">Commission</th>}
            </tr>
          </thead>
          <tbody>
            {standings.map((p) => {
              const isOpen = selected === p.profileId;
              const opens = canOpen(p.profileId);
              const owed = Math.max(0, p.commissionEarned - p.commissionPaid);
              return (
                <tr
                  key={p.profileId}
                  onClick={opens ? () => onSelect(p.profileId) : undefined}
                  className={cn("border-b border-border last:border-0", opens && "cursor-pointer hover:bg-accent/40", isOpen && "bg-primary/5")}
                >
                  <td className="p-2 font-semibold tabular-nums text-muted-foreground">{p.rank}</td>
                  <td className="p-2">
                    <span className="inline-flex items-center gap-1 font-medium">
                      {opens && (isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />)}
                      {p.name}
                    </span>
                  </td>
                  <td className="p-2 text-right tabular-nums">{p.comments}</td>
                  <td className="p-2 text-right tabular-nums">{p.dms}</td>
                  <td className="p-2 text-right tabular-nums">
                    {p.clicked}
                    {clickRate(p) != null && <span className="ml-1 text-xs text-muted-foreground">{Math.round((clickRate(p) as number) * 100)}%</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{p.replied}</td>
                  <td className="p-2 text-right tabular-nums">{p.bookings}</td>
                  <td className={cn("p-2 text-right font-semibold tabular-nums", p.closed > 0 && "text-emerald-700")}>{p.closed}</td>
                  {showMoney && <td className="p-2 text-right tabular-nums">{p.collected > 0 ? money(p.collected) : "—"}</td>}
                  {showMoney && <td className="p-2 text-right tabular-nums">
                    {p.commissionEarned > 0 ? (
                      <>
                        {money(p.commissionEarned)}
                        <span className={cn("ml-1 text-xs", owed > 0 ? "text-amber-800" : "text-muted-foreground")}>
                          {owed > 0 ? `${money(owed)} owed` : "paid"}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One person, opened: every comment and message they answered, and who booked from them. */
function PersonDetail({ standing, board, onClose }: { standing: PersonStanding | null; board: OutreachBoard; onClose: () => void }) {
  if (!standing) return null;
  const rows = board.rows.filter((row) => row.profileId === standing.profileId);
  const bookings = rows.flatMap((row) => board.bookingsByCode[row.code] ?? []);
  return (
    <section className="rounded-lg border border-primary/40 bg-card/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">
            #{standing.rank} {standing.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            {standing.comments} comment{standing.comments === 1 ? "" : "s"} · {standing.dms} DM{standing.dms === 1 ? "" : "s"} · {bookings.length} booked · {standing.closed} closed
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground underline">
          Close
        </button>
      </div>
      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who booked from them</p>
        <div className="mt-1.5">
          <BookedPeople bookings={bookings} rows={rows} />
        </div>
      </div>
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Everything they answered</p>
        <div className="mt-1.5">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : <LinkList rows={rows} bookingsByCode={board.bookingsByCode} />}
        </div>
      </div>
    </section>
  );
}

/**
 * One room, opened.
 *
 * The people first, because that is what somebody tapped the room to see,
 * then every comment that went into it with what each one did.
 */
function RoomDetail({ room, board, onClose }: { room: GroupTally; board: OutreachBoard; onClose: () => void }) {
  const rows = board.rows.filter((row) => groupKey(row) === room.key);
  const bookings = rows.flatMap((row) => board.bookingsByCode[row.code] ?? []);

  return (
    <section className="rounded-lg border border-primary/40 bg-card/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{room.audience}</h3>
          <p className="text-xs text-muted-foreground">
            {platformLabel(room.platform)} · {rows.length} comment{rows.length === 1 ? "" : "s"} · {bookings.length} booked
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground underline">
          Close
        </button>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who booked from this room</p>
        <div className="mt-1.5">
          <BookedPeople bookings={bookings} rows={rows} />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every comment in this room</p>
        <div className="mt-1.5">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            <LinkList rows={rows} bookingsByCode={board.bookingsByCode} />
          )}
        </div>
      </div>
    </section>
  );
}

function LinkList({ rows, bookingsByCode }: { rows: OutreachListRow[]; bookingsByCode: Record<string, OutreachBooking[]> }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <LinkRow key={row.id} row={row} bookings={bookingsByCode[row.code] ?? []} />
      ))}
    </ul>
  );
}

function LinkRow({ row, bookings }: { row: OutreachListRow; bookings: OutreachBooking[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showBooked, setShowBooked] = useState(false);

  function answer(response: OutreachResponse | null) {
    start(async () => {
      await recordResponse({ id: row.id, response, note: "" });
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{row.audience || platformLabel(row.platform)}</span>
        <span className="text-xs text-muted-foreground">{kindLabel(row.kind)}</span>
        {row.sentTo && <span className="text-xs text-muted-foreground">to {row.sentTo}</span>}
        {row.fromPage && <span className="text-xs text-muted-foreground">from {row.fromPage}</span>}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{row.code}</span>
      </div>

      {row.note && <p className="mt-1 text-sm">{row.note}</p>}

      {/* Both halves of a reply, weeks later. The link on its own is only
          useful for a post nobody has written yet; the words are what somebody
          came back for when a paste failed or the phone locked. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CopyButton text={row.link} label="Copy link" />
        {/* What actually went up beats what was written for it. The draft is
            still there for a second post in the same group. */}
        {(row.postedComment ?? row.comment) && (
          <CopyButton text={row.postedComment ?? row.comment ?? ""} label="Copy comment" />
        )}
        {(row.postedComment ?? row.comment) && <ShowComment comment={row.postedComment ?? row.comment ?? ""} />}
        {row.postedComment && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            {VERSION_LABEL[postedVersion(row.comment, row.postedComment)]}
          </span>
        )}
        {!row.postedComment && row.comment && (
          <span className="text-[11px] text-muted-foreground">Not yet confirmed what went up</span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{row.personName}</span>
        <span>{new Date(row.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span className={cn(row.clickCount > 0 && "font-medium text-foreground")}>
          {row.clickCount === 0
            ? "Not opened"
            : `Opened ${row.clickCount} time${row.clickCount === 1 ? "" : "s"}`}
        </span>
        {bookings.length > 0 && (
          <button
            type="button"
            onClick={() => setShowBooked((v) => !v)}
            className="font-medium text-primary underline underline-offset-2"
          >
            Booked {bookings.length === 1 ? "" : `${bookings.length} `}
            {showBooked ? "(hide)" : "(who?)"}
          </button>
        )}
        {row.response && <span>{responseLabel(row.response)}</span>}
      </div>

      {showBooked && (
        <div className="mt-2">
          <BookedPeople bookings={bookings} rows={[row]} />
        </div>
      )}

      {/* Only where there was one person to answer. Asking whether a page post
          "replied" is asking about nobody. */}
      {goesToOnePerson(row.kind) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {RESPONSES.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={pending}
              onClick={() => answer(row.response === option.key ? null : option.key)}
              className={cn(
                "min-h-8 rounded-full border px-2.5 text-[11px]",
                row.response === option.key
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The people who booked, with the details to ring them.
 *
 * Editable in place, because the number a client typed into a booking form
 * on a phone is wrong often enough that fixing it should not mean finding
 * the client screen. Saved to the client, so it is right everywhere.
 */
function BookedPeople({ bookings, rows }: { bookings: OutreachBooking[]; rows: OutreachListRow[] }) {
  if (bookings.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody has booked from here yet.</p>;
  }
  const commentFor = new Map(rows.map((row) => [row.code, row]));
  return (
    <ul className="flex flex-col gap-2">
      {bookings.map((booking) => (
        <BookedPerson key={booking.jobId} booking={booking} via={rows.length > 1 ? commentFor.get(booking.code) ?? null : null} />
      ))}
    </ul>
  );
}

function BookedPerson({ booking, via }: { booking: OutreachBooking; via: OutreachListRow | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(booking.name);
  const [phone, setPhone] = useState(booking.phone ?? "");
  const [email, setEmail] = useState(booking.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      try {
        await updateCustomerContact(booking.customerId, {
          name: name.trim() || booking.name,
          phone: phone.trim() || null,
          email: email.trim() || null,
        });
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that.");
      }
    });
  }

  const tel = phone.replace(/[^\d+]/g, "");

  return (
    <li className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm">
      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-0.5 text-xs">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-0.5 text-xs">
              Phone
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={pending}
                inputMode="tel"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                inputMode="email"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {pending ? "Saving" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium">{name}</span>
            {tel ? (
              <a href={`tel:${tel}`} className="text-primary underline underline-offset-2">
                {phone}
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">no phone</span>
            )}
            {email ? (
              <a href={`mailto:${email}`} className="text-primary underline underline-offset-2">
                {email}
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">no email</span>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{booking.address}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>Booked {new Date(booking.bookedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            {booking.evaluationDate && (
              <span>
                Visit {formatVisit(booking.evaluationDate)}
                {booking.evaluationStatus === "completed" ? ", done" : booking.evaluationStatus === "cancelled" ? ", cancelled" : ""}
              </span>
            )}
            {via && <span>via {kindLabel(via.kind).toLowerCase()} {via.code}</span>}
            <Link href={`/jobs/${booking.jobId}`} className="text-primary underline underline-offset-2">
              Open the job
            </Link>
          </p>
          <ConversionLine booking={booking} />
        </>
      )}
    </li>
  );
}

/** The visit on the business clock. */
function formatVisit(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/**
 * The words, on request.
 *
 * Folded away rather than printed, because a list of twenty replies is a list
 * somebody scans and twenty paragraphs is a list nobody scans. The copy button
 * beside it is the common case; reading it is the rarer one.
 */
function ShowComment({ comment }: { comment: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-muted-foreground underline"
      >
        {open ? "Hide it" : "Read it"}
      </button>
      {open && (
        <p className="w-full whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-xs leading-5">
          {comment}
        </p>
      )}
    </>
  );
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Whether the booking became a job, and what that earned whoever posted.
 *
 * Three facts in one line: converted or not; the commission, as a share of
 * what the client has paid so far; and whether it has been handed over. The
 * owner gets a button on the last one, because the owner is who hands it
 * over.
 */
function ConversionLine({ booking }: { booking: OutreachBooking }) {
  const canPay = useContext(CanPayContext);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const c = booking.commission;

  function markPaid() {
    setError(null);
    start(async () => {
      const result = await recordCommissionPaid({ profileId: booking.posterId, lines: [{ jobId: booking.jobId, amount: c.owed }] });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (!c.converted) {
    return (
      <p className="mt-1 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
        Not converted yet{booking.jobStatus === "cancelled" ? " (cancelled)" : booking.jobStatus === "quoted" ? " (proposal out)" : ""}.
      </p>
    );
  }

  const paidLine =
    c.state === "paid_out"
      ? `Paid out${booking.lastPaidAt ? ` ${new Date(booking.lastPaidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
      : c.state === "part_paid"
        ? `${money(c.paidOut)} paid out, ${money(c.owed)} still owed`
        : c.state === "earning"
          ? "Not paid out yet"
          : "Nothing to pay out until the client pays";

  return (
    <div className="mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-xs">
      <p className="flex flex-wrap gap-x-2 gap-y-0.5">
        <span className="font-semibold text-emerald-800">Converted</span>
        <span>
          {money(booking.collected)} collected{booking.contractValue != null ? ` of ${money(booking.contractValue)}` : ""}
        </span>
        <span>
          {c.pct}% commission: <span className="font-semibold">{money(c.earned)}</span>
        </span>
        <span className={c.state === "paid_out" ? "text-emerald-800" : "text-amber-800"}>{paidLine}</span>
        {canPay && c.owed > 0 && (
          <button type="button" onClick={markPaid} disabled={pending} className="text-primary underline underline-offset-2 disabled:opacity-50">
            {pending ? "Recording" : `Mark ${money(c.owed)} paid out`}
          </button>
        )}
      </p>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
