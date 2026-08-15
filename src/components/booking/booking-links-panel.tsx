"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setAffiliate } from "@/lib/actions/affiliate-actions";

export interface AffiliateRow {
  id: string;
  name: string;
  link: string | null;
  /** Granted explicitly, so it can be revoked. Role-derived affiliates can't. */
  isExplicit: boolean;
}

function CopyRow({ label, link }: { label: string; link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{link}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function embedSnippet(link: string): string {
  return `<iframe src="${link}" title="Schedule an evaluation" style="width:100%;max-width:640px;height:900px;border:none;" loading="lazy"></iframe>`;
}

function EmbedWidget({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = embedSnippet(link);

  async function handleCopy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Website widget</p>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy code"}
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Paste this into your website&apos;s HTML wherever you want the booking form to appear.
      </p>
      <pre className="overflow-x-auto rounded-md bg-black/80 p-2.5 text-[11px] text-white">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}

function AddAffiliate({ candidates }: { candidates: { id: string; name: string }[] }) {
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (candidates.length === 0) {
    return <p className="text-xs text-muted-foreground">Everyone on the team is already an affiliate.</p>;
  }

  function handleAdd() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await setAffiliate(selected, true);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSelected("");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={isPending}>
          <SelectTrigger className="h-9 w-56 text-sm">
            <SelectValue placeholder="Pick a team member" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" onClick={handleAdd} disabled={isPending || !selected}>
          <Plus className="h-4 w-4" />
          {isPending ? "Adding..." : "Add affiliate"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AffiliateRowItem({ affiliate }: { affiliate: AffiliateRow }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await setAffiliate(affiliate.id, false);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {affiliate.link ? (
            <CopyRow label={affiliate.name} link={affiliate.link} />
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 p-3">
              <p className="text-sm font-medium">{affiliate.name}</p>
              <p className="text-xs text-muted-foreground">Setting up...</p>
            </div>
          )}
        </div>
        {affiliate.isExplicit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={isPending}
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${affiliate.name} as an affiliate`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The org's general link, the embeddable widget, and every affiliate's own
 * link — all in one place under Calendar settings. */
export function BookingLinksPanel({
  generalLink,
  affiliates,
  candidates,
}: {
  generalLink: string | null;
  affiliates: AffiliateRow[];
  /** Team members who aren't affiliates yet. */
  candidates: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">General booking link</p>
        <p className="text-xs text-muted-foreground">
          For ads and marketing — not tied to any one person.
        </p>
        {generalLink ? (
          <>
            <CopyRow label="General booking link" link={generalLink} />
            <EmbedWidget link={generalLink} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Your organization&apos;s link is being set up — refresh in a moment.</p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-semibold">Affiliates</p>
        <p className="text-xs text-muted-foreground">
          Clients who book through an affiliate&apos;s link are attributed to them. Adding someone creates their
          link straight away.
        </p>
        <AddAffiliate candidates={candidates} />
        <div className="mt-2 flex flex-col gap-2">
          {affiliates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No affiliates yet.</p>
          ) : (
            affiliates.map((affiliate) => <AffiliateRowItem key={affiliate.id} affiliate={affiliate} />)
          )}
        </div>
      </div>
    </div>
  );
}

/** The signed-in person's own link, shown on their Calendar page. */
export function MyBookingLink({ link }: { link: string }) {
  return (
    <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6">
      <p className="text-sm font-semibold">Your booking link</p>
      <p className="text-xs text-muted-foreground">Clients who book through this are attributed to you.</p>
      <CopyRow label="Your booking link" link={link} />
    </div>
  );
}
