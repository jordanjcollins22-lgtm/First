"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { completePlaidLink, createPlaidLinkToken, disconnectBank, syncBankNow } from "@/lib/actions/accounting-actions";

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}
declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void;
        onExit?: (error: { display_message?: string; error_message?: string } | null) => void;
      }) => PlaidHandler;
    };
  }
}

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadPlaid(): Promise<NonNullable<Window["Plaid"]>> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLAID_SCRIPT;
    script.async = true;
    script.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid didn't load")));
    script.onerror = () => reject(new Error("Couldn't load Plaid"));
    document.head.appendChild(script);
  });
}

export function PlaidConnectButton() {
  const [status, setStatus] = useState<{ error?: string; message?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function connect() {
    setStatus(null);
    startTransition(async () => {
      const { linkToken, error } = await createPlaidLinkToken();
      if (!linkToken) {
        setStatus({ error });
        return;
      }
      try {
        const Plaid = await loadPlaid();
        const handler = Plaid.create({
          token: linkToken,
          onSuccess: (publicToken, metadata) => {
            setStatus({ message: "Connecting and pulling transactions…" });
            completePlaidLink(publicToken, metadata.institution?.name ?? null)
              .then(setStatus)
              .catch(() => setStatus({ error: "Connected, but saving failed. Try again." }))
              .finally(() => handler.destroy());
          },
          onExit: (err) => {
            if (err) setStatus({ error: err.display_message || err.error_message || "Bank connection was cancelled." });
            handler.destroy();
          },
        });
        handler.open();
      } catch (err) {
        setStatus({ error: err instanceof Error ? err.message : "Couldn't open Plaid." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={connect} disabled={isPending} className="self-start">
        {isPending ? "Opening…" : "Connect a bank or card"}
      </Button>
      {status?.error && <p className="text-sm text-destructive">{status.error}</p>}
      {status?.message && <p className="text-sm text-green-700">{status.message}</p>}
    </div>
  );
}

export function ConnectionActions({ connectionId }: { connectionId: string }) {
  const [status, setStatus] = useState<{ error?: string; message?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => startTransition(async () => setStatus(await syncBankNow(connectionId)))}
        >
          {isPending ? "Working…" : "Sync now"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            if (!confirm("Disconnect this bank? Imported transactions stay in your books.")) return;
            startTransition(async () => setStatus(await disconnectBank(connectionId)));
          }}
        >
          Disconnect
        </Button>
      </div>
      {status?.error && <p className="text-xs text-destructive">{status.error}</p>}
      {status?.message && <p className="text-xs text-green-700">{status.message}</p>}
    </div>
  );
}
