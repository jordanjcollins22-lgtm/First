"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { FollowUpDone } from "@/components/phone/follow-up-done";
import { ProposalCloser } from "@/components/phone/proposal-closer";
import { decidePayout, requestPayout, withdrawPayout } from "@/lib/actions/payout-actions";
import type { Wallet } from "@/lib/wallet";

/**
 * The parts of the phone homes that do something on a tap: one-at-a-time
 * Do now, the client search, and the wallet's payout button.
 */

export interface OneItem {
  tag: string;
  who: string;
  whoHref?: string;
  body?: React.ReactNode;
  main: { label: string; href?: string; payout?: string };
  alt?: string;
  /** An open proposal's id: Yes or No and why, in place of the main button. */
  closeProposal?: string;
  /** A follow-up's id: Done with what happened, in place of the main button. */
  followUp?: string;
}

/** Do now: one item at a time, "1 of N". The main button does it, Skip moves on. */
export function OneAtATime({ title, items, children }: { title: string; items: OneItem[]; children?: React.ReactNode }) {
  const [at, setAt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const n = items.length;
  const next = () => {
    setNote(null);
    setAt((i) => (n ? (i + 1) % n : 0));
  };
  const it = items[Math.min(at, n - 1)];

  return (
    <div className="vx-card vx-one">
      <div className="vx-one-h">
        <span className="vx-ct">
          {title} · {n}
        </span>
        {n > 0 && (
          <span className="vx-one-n">
            {Math.min(at, n - 1) + 1} of {n}
          </span>
        )}
      </div>
      {it ? (
        <div className="vx-one-i on">
          <span className="vx-tag">{it.tag}</span>
          {it.whoHref ? (
            <Link href={it.whoHref} className="vx-who vx-tap">
              <span>{it.who}</span>
            </Link>
          ) : (
            <div className="vx-who">{it.who}</div>
          )}
          {it.body}
          {it.closeProposal ? (
            <ProposalCloser key={it.closeProposal} proposalId={it.closeProposal} onSkip={next} />
          ) : it.followUp ? (
            <FollowUpDone key={it.followUp} id={it.followUp} onSkip={next} />
          ) : (
            <div className="vx-2b">
              {it.main.href ? (
                <Link href={it.main.href} className="vx-cta">
                  {it.main.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className="vx-cta"
                  disabled={busy}
                  onClick={() => {
                    const id = it.main.payout;
                    if (!id) return next();
                    start(async () => {
                      const r = await decidePayout(id, true, "");
                      setNote(r.ok ? r.message : r.error);
                      if (r.ok) router.refresh();
                    });
                  }}
                >
                  {it.main.label}
                </button>
              )}
              <button type="button" className="vx-cta vx-alt" onClick={next}>
                {it.alt ?? "Skip"}
              </button>
            </div>
          )}
          {note && <div className="vx-note">{note}</div>}
        </div>
      ) : (
        <div className="vx-sm">Nothing needs you right now.</div>
      )}
      {children}
    </div>
  );
}

/** Search clients and projects: type a name, tap it to open their page. */
export function ClientSearch({ clients }: { clients: { id: string; name: string; href: string; sub?: string }[] }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return clients.filter((c) => c.name.toLowerCase().includes(t) || (c.sub ?? "").toLowerCase().includes(t)).slice(0, 8);
  }, [q, clients]);
  return (
    <div>
      <div className="vx-search-w">
        <input className="vx-search" placeholder="Search clients and projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients and projects" />
      </div>
      {q.trim() && (
        <div className="vx-hits">
          {hits.length ? (
            hits.map((c) => (
              <Link key={c.id} href={c.href} className="vx-row vx-tap">
                <span>{c.name}</span>
                <b>{c.sub}</b>
              </Link>
            ))
          ) : (
            <div className="vx-row">
              <span>No match</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The Request payout button inside the wallet, or the request already waiting. */
export function PayoutButton({ wallet }: { wallet: Pick<Wallet, "open" | "canRequest"> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await task();
      setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  const open = wallet.open;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  return (
    <>
      {open ? (
        <div className="vx-q">
          You asked for {money(open.amount)}. {open.status === "approved" ? "Approved, on its way to your bank." : "Waiting on approval."}
          {open.status === "requested" && (
            <button type="button" className="vx-cl-back" style={{ display: "block", marginTop: 4, background: "none", border: 0, padding: 0 }} disabled={busy} onClick={() => run(() => withdrawPayout(open.id))}>
              Take it back
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="vx-cta" disabled={busy || wallet.canRequest <= 0} onClick={() => run(requestPayout)}>
          Request payout
        </button>
      )}
      {note && <div className={note.ok ? "vx-note ok" : "vx-note bad"}>{note.text}</div>}
    </>
  );
}
