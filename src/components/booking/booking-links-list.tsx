"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

function CopyLinkRow({ label, link }: { label: string; link: string }) {
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

export function BookingLinksList({
  adLink,
  myLink,
  iAmQualified,
  isAdmin,
  affiliateProfiles,
}: {
  adLink: string | null;
  myLink: string | null;
  iAmQualified: boolean;
  isAdmin: boolean;
  affiliateProfiles: { id: string; name: string; link: string | null }[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {adLink && (
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Your organization&apos;s link</p>
          <p className="mb-2 text-xs text-muted-foreground">Use this for ads and general marketing — not tied to any one person.</p>
          <CopyLinkRow label="General booking link" link={adLink} />
        </div>
      )}

      {iAmQualified && (
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Your personal link</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Clients who book through this link are attributed to you.
          </p>
          {myLink ? (
            <CopyLinkRow label="Your booking link" link={myLink} />
          ) : (
            <p className="text-sm text-muted-foreground">Your link is being set up — refresh in a moment.</p>
          )}
        </div>
      )}

      {isAdmin && (
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Everyone&apos;s links</p>
          <div className="flex flex-col gap-2">
            {affiliateProfiles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No evaluators or account managers yet — add the &quot;evaluator&quot; or &quot;account manager&quot; role
                to a team member on the Team page to give them a link.
              </p>
            )}
            {affiliateProfiles.map((p) =>
              p.link ? (
                <CopyLinkRow key={p.id} label={p.name} link={p.link} />
              ) : (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 p-3">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Setting up...</p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
