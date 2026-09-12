"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Loader2, RefreshCw } from "lucide-react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

import { Button } from "@/components/ui/button";
import type { BankStatus } from "@/lib/data/ops";

/**
 * The bank, linked in Plaid's window.
 *
 * One button. Plaid asks for the FNB login in its own window; the app
 * never sees it. When it closes, the accounts and their balances are read
 * at once and the pulse's cash is the bank's from then on. A login that
 * lapses is redone with the same button.
 */

function money(n: number | null): string {
  return n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function BankLink({ bank, configured, mode }: { bank: BankStatus; configured: boolean; mode: "live" | "sandbox" }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(linkId: string | null) {
    setError(null);
    setBusy("asking");
    try {
      const res = await fetch("/api/bank/link-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(linkId ? { linkId } : {}) });
      const data = (await res.json()) as { linkToken?: string; error?: string };
      if (!res.ok || !data.linkToken) throw new Error(data.error ?? "The bank could not be reached.");
      setRelinkId(linkId);
      setToken(data.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      setBusy("reading");
      setError(null);
      try {
        if (relinkId) {
          // The login was redone on an existing link; read it again.
          const res = await fetch("/api/bank/sync", { method: "POST" });
          if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "The bank could not be read.");
        } else {
          const res = await fetch("/api/bank/exchange", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ publicToken, institution: metadata.institution }),
          });
          const data = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(data.error ?? "The bank could not be linked.");
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
        setToken(null);
      }
    },
    [relinkId, router]
  );

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit: () => setToken(null) });
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  async function sync() {
    setBusy("reading");
    setError(null);
    try {
      const res = await fetch("/api/bank/sync", { method: "POST" });
      const data = (await res.json()) as { error?: string; failed?: string[] };
      if (!res.ok) throw new Error(data.error ?? "The bank could not be read.");
      if (data.failed && data.failed.length > 0) setError(data.failed.join("; "));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function unlink(linkId: string) {
    if (!window.confirm("Let this bank link go? The app stops reading the account; nothing changes at the bank.")) return;
    setBusy("unlinking");
    setError(null);
    try {
      const res = await fetch("/api/bank/sync", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ linkId }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "The link could not be dropped.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const needsRelink = bank.links.find((l) => l.status !== "ok");

  return (
    <div className="rounded-lg border border-border/60 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Landmark className="h-3.5 w-3.5" />
          {bank.linked ? `${bank.links.map((l) => l.institution ?? "Bank").join(", ")} linked` : "Bank"}
          {configured && (
            <span className={mode === "live" ? "rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" : "rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"}>
              {mode === "live" ? "live" : "test bank"}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {bank.linked && (
            <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" disabled={busy != null} onClick={sync}>
              {busy === "reading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Read now
            </button>
          )}
          {!configured ? null : needsRelink ? (
            <Button type="button" size="sm" disabled={busy != null} onClick={() => ask(needsRelink.id)}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Landmark className="mr-1 h-3.5 w-3.5" />} Log in to the bank again
            </Button>
          ) : (
            <Button type="button" size="sm" variant={bank.linked ? "outline" : "default"} disabled={busy != null} onClick={() => ask(null)}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Landmark className="mr-1 h-3.5 w-3.5" />} {bank.linked ? "Link another bank" : "Link the bank"}
            </Button>
          )}
        </div>
      </div>
      {!configured && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Reading the bank needs Plaid keys on the server: PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV. Until then the cash on hand is typed in below.
        </p>
      )}
      {!bank.linked && configured && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {mode === "live"
            ? "Log in to FNB (or any bank) in Plaid's window; the app never sees the login. From then on the cash is read from the account every morning and nobody types a balance."
            : "PLAID_ENV is not \u201cproduction\u201d, so this links Plaid's pretend bank (user_good / pass_good), not FNB. Good for checking the flow works; set it to production for the real account."}
        </p>
      )}
      {bank.linked && mode !== "live" && (
        <p className="mt-1 text-[11px] text-amber-700">
          These are Plaid&apos;s invented balances, not your money, so the cash signal and the spending plan ignore them and still use the cash entered below. Set PLAID_ENV to production and link again for the real account.
        </p>
      )}
      {needsRelink && <p className="mt-1 text-[11px] text-amber-700">{needsRelink.institution ?? "The bank"} needs its login redone before it can be read again{needsRelink.lastError ? ` (${needsRelink.lastError})` : ""}.</p>}
      {bank.accounts.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {bank.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className={a.include ? "" : "text-muted-foreground"}>
                {a.name}
                {a.mask ? ` ····${a.mask}` : ""}
                <span className="text-muted-foreground"> · {a.subtype ?? a.type}</span>
                {!a.include && <span className="text-muted-foreground"> · not counted as cash</span>}
              </span>
              <span className="tabular-nums">{money(a.available ?? a.current)}</span>
            </li>
          ))}
        </ul>
      )}
      {bank.linked && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {money(bank.cash)} counted as cash
          {bank.links[0]?.lastSyncedAt ? `, read ${new Date(bank.links[0].lastSyncedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}; {bank.transactions30} transactions in the last thirty days.
          {bank.links.map((l) => (
            <button key={l.id} type="button" className="ml-2 text-muted-foreground underline" disabled={busy != null} onClick={() => unlink(l.id)}>
              Unlink {l.institution ?? "bank"}
            </button>
          ))}
        </p>
      )}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
