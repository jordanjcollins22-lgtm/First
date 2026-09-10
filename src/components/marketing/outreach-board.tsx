"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  bookingRate,
  clickRate,
  kindLabel,
  goesToOnePerson,
  platformLabel,
  RESPONSES,
  responseLabel,
  type Funnel,
  type OutreachResponse,
} from "@/lib/outreach-links";
import { recordResponse } from "@/lib/actions/outreach-link-actions";
import type { OutreachBoard, OutreachListRow } from "@/lib/data/outreach-links";

/**
 * What came of every link handed out.
 *
 * Four numbers in the order they happen, and that order is the whole point.
 * Handed out, opened, answered, booked. A room that never opens anything and a
 * room that opens everything and books nobody are different problems needing
 * opposite decisions, and bookings alone cannot tell them apart.
 */
export function OutreachBoardView({ board }: { board: OutreachBoard }) {
  const [tab, setTab] = useState<"rooms" | "recent" | "people" | "how">("rooms");

  const tabs = [
    { key: "rooms" as const, label: "Rooms" },
    { key: "recent" as const, label: "Every link" },
    { key: "people" as const, label: "Who posted" },
    { key: "how" as const, label: "What works" },
  ];

  return (
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
        <Table
          caption="Where a link landed. Ordered by bookings, because one booking from twenty beats a perfect record from one."
          rows={board.groups.map((group) => ({
            key: `${group.platform}:${group.audience}`,
            name: group.audience,
            detail: platformLabel(group.platform),
            funnel: group,
          }))}
        />
      )}

      {tab === "people" && (
        <Table
          caption="Who handed links out, and what came back."
          rows={board.people.map((person) => ({
            key: person.profileId,
            name: person.name,
            detail: null,
            funnel: person,
          }))}
        />
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

      {tab === "recent" && <LinkList rows={board.rows} />}
    </div>
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
}: {
  caption: string;
  rows: { key: string; name: string; detail: string | null; funnel: Funnel }[];
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
              return (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="p-2">
                    <span className="font-medium">{row.name}</span>
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

function LinkList({ rows }: { rows: OutreachListRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <LinkRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function LinkRow({ row }: { row: OutreachListRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

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

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{row.personName}</span>
        <span>{new Date(row.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span className={cn(row.clickCount > 0 && "font-medium text-foreground")}>
          {row.clickCount === 0
            ? "Not opened"
            : `Opened ${row.clickCount} time${row.clickCount === 1 ? "" : "s"}`}
        </span>
        {row.booked && <span className="font-medium text-primary">Booked</span>}
        {row.response && <span>{responseLabel(row.response)}</span>}
      </div>

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
