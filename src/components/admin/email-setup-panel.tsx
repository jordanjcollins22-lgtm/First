"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Copy, Plus, RefreshCw, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EmailSetup, SendingDomain } from "@/lib/data/email-setup";
import { canRecheck, describeStatus, type MailStream } from "@/lib/sending-domains";
import {
  addSender,
  addSendingDomain,
  makeSenderDefault,
  recheckSendingDomain,
  removeSender,
  removeSendingDomain,
} from "@/lib/actions/email-domain-actions";

const STREAM_LABEL: Record<MailStream, string> = {
  transactional: "Proposals & invoices",
  marketing: "Campaigns",
};

const STREAM_BLURB: Record<MailStream, string> = {
  transactional: "Mail somebody asked for — a proposal, an invoice, a receipt.",
  marketing: "Anything sent to a list. Kept on its own domain so a bad campaign can't touch the mail above.",
};

/**
 * Setting up email, one question at a time.
 *
 * The shape of this screen is the shape of the job: name a subdomain, get
 * back the DNS records to paste at your registrar, come back and check. It
 * refuses the root domain outright rather than warning about it, because the
 * whole value of the arrangement is that the root never sends anything.
 */
export function EmailSetupPanel({ setup }: { setup: EmailSetup }) {
  const byStream = (stream: MailStream) => setup.domains.find((d) => d.stream === stream);

  return (
    <div className="space-y-4">
      {!setup.connected && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-4 w-4" />
            Email isn&apos;t connected yet
          </p>
          <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
            Create an API key at resend.com and set <code>RESEND_API_KEY</code> in your
            environment variables, then redeploy. Everything below works once that&apos;s in.
          </p>
        </div>
      )}

      <div>
        <p className="text-sm text-muted-foreground">
          Two subdomains, kept apart on purpose. Reputation follows whichever domain signs the
          mail — so campaigns go from their own, and your main domain sends nothing at all, which
          is what keeps it clean.
        </p>
      </div>

      {(["transactional", "marketing"] as MailStream[]).map((stream) => {
        const domain = byStream(stream);
        return (
          <section key={stream} className="rounded-xl border border-border bg-card/60 p-3">
            <p className="text-sm font-semibold">{STREAM_LABEL[stream]}</p>
            <p className="mb-2 text-xs text-muted-foreground">{STREAM_BLURB[stream]}</p>
            {domain ? (
              <DomainCard domain={domain} />
            ) : (
              <AddDomainForm stream={stream} suggestion={setup.suggestions[stream]} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function AddDomainForm({
  stream,
  suggestion,
}: {
  stream: MailStream;
  suggestion: string | null;
}) {
  const [value, setValue] = useState(suggestion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={suggestion ?? `${stream === "marketing" ? "news" : "send"}.yourdomain.com`}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
      />
      <Button
        type="button"
        className="w-full gap-1.5"
        disabled={pending || !value.trim()}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await addSendingDomain({ hostname: value, stream });
            if (!result.ok) setError(result.message);
          });
        }}
      >
        <Plus className="h-4 w-4" />
        {pending ? "Setting up…" : "Add this domain"}
      </Button>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

function DomainCard({ domain }: { domain: SendingDomain }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const verified = domain.status === "verified";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-mono text-sm font-semibold">{domain.hostname}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            verified
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
              : "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
          }`}
        >
          {verified ? "Verified" : "Pending"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {describeStatus(domain.status, domain.records)}
      </p>

      {!verified && domain.records.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-2">
          <p className="mb-1.5 text-xs font-semibold">Add these at your domain host</p>
          <ul className="flex flex-col gap-2">
            {domain.records.map((record, i) => (
              <li key={i} className="rounded-md border border-border p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {record.type}
                  {record.priority != null ? ` · priority ${record.priority}` : ""}
                </p>
                <CopyRow label="Name" value={record.name} />
                <CopyRow label="Value" value={record.value} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        {canRecheck(domain.status) && (
          <Button
            type="button"
            variant="outline"
            className="flex-1 gap-1.5"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const result = await recheckSendingDomain(domain.id);
                if (!result.ok) setError(result.message);
              });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {pending ? "Checking…" : "Check again"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="gap-1.5 text-destructive"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const result = await removeSendingDomain(domain.id);
              if (!result.ok) setError(result.message);
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
      </div>

      <SenderList domain={domain} />

      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-start gap-1.5">
        {/* Breaks anywhere: a DKIM value is 200-odd unbroken characters and
            would otherwise push the whole page sideways on a phone. */}
        <code className="min-w-0 flex-1 break-all text-[11px] leading-snug">{value}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              },
              () => {}
            );
          }}
          className="shrink-0 rounded p-1 hover:bg-muted"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function SenderList({ domain }: { domain: SendingDomain }) {
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-lg border border-border bg-background p-2">
      <p className="mb-1.5 text-xs font-semibold">Send from</p>

      {domain.senders.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">No addresses yet.</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1">
          {domain.senders.map((sender) => (
            <li key={sender.id} className="flex items-center gap-1.5">
              {sender.isDefault ? (
                <Star className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />
              ) : (
                <button
                  type="button"
                  onClick={() => start(async () => void (await makeSenderDefault(sender.id)))}
                  className="shrink-0 rounded p-0.5 hover:bg-muted"
                  aria-label="Make default"
                >
                  <Star className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
              <span className="min-w-0 flex-1 truncate text-xs">
                {sender.displayName ? `${sender.displayName} · ` : ""}
                {sender.address}
              </span>
              <button
                type="button"
                onClick={() => start(async () => void (await removeSender(sender.id)))}
                className="shrink-0 rounded p-0.5 text-destructive hover:bg-muted"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-1.5">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={`you@${domain.hostname}`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name shown to the recipient (optional)"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          <input
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="Replies go to (optional — your real inbox)"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={pending || !address.trim()}
              onClick={() => {
                setError(null);
                start(async () => {
                  const result = await addSender({
                    domainId: domain.id,
                    address,
                    displayName,
                    replyTo,
                  });
                  if (result.ok) {
                    setAddress("");
                    setDisplayName("");
                    setReplyTo("");
                    setAdding(false);
                  } else {
                    setError(result.message);
                  }
                });
              }}
            >
              {pending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-1.5"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add an address
        </Button>
      )}

      {error && <p className="mt-1.5 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
