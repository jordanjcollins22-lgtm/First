"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { respondToProposal } from "@/lib/actions/public-proposal-actions";
import type { PublicProposal } from "@/lib/data/public-proposal";
import type { ProposalStatus } from "@/types/domain";

function formatTotal(total: number | null): string {
  if (total == null) return "Contact us for pricing";
  return `$${Math.round(total).toLocaleString()}`;
}

export function ProposalView({ data, token }: { data: PublicProposal; token: string }) {
  const { proposal, propertyAddress, customerName, organizationName } = data;
  const [status, setStatus] = useState<ProposalStatus>(proposal.status);
  const [respondedAt, setRespondedAt] = useState(proposal.responded_at);
  const [decliningNote, setDecliningNote] = useState("");
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function respond(response: "accepted" | "declined", note = "") {
    setError(null);
    startTransition(async () => {
      try {
        await respondToProposal(token, response, note);
        setStatus(response);
        setRespondedAt(new Date().toISOString());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{organizationName}</p>
        <h1 className="text-2xl font-bold">Your Property Proposal</h1>
        <p className="text-muted-foreground">
          {customerName ? `Prepared for ${customerName}` : "Prepared for you"} — {propertyAddress}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          We walked your property and put together exactly what we&apos;d recommend. Here&apos;s the scope, and
          what it takes to get it all done right.
        </p>
      </div>

      {proposal.site_image_path && (
        <div className="overflow-hidden rounded-2xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={canvasImageUrl(proposal.site_image_path)} alt="Your property" className="w-full object-cover" />
        </div>
      )}

      <div className="flex flex-col gap-6">
        <h2 className="text-lg font-semibold">Scope of work</h2>
        {proposal.scope_snapshot.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work areas on this proposal.</p>
        ) : (
          proposal.scope_snapshot.map((zone, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
              <div>
                <p className="font-semibold">{zone.zoneName}</p>
                <p className="text-sm text-primary">{zone.serviceLabel}</p>
              </div>
              {zone.scopeText && <p className="text-sm text-muted-foreground">{zone.scopeText}</p>}
              {zone.photoPaths.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {zone.photoPaths.map((path) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={path}
                      src={canvasImageUrl(path)}
                      alt={`${zone.zoneName} photo`}
                      className="aspect-square rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col items-center gap-1 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">Total investment</p>
        <p className="text-4xl font-bold text-primary">{formatTotal(proposal.total_cost)}</p>
      </div>

      <div className="flex flex-col items-center gap-3">
        {status === "pending" ? (
          <>
            {!showDeclineForm ? (
              <div className="flex w-full gap-3">
                <Button type="button" size="xl" className="flex-1" disabled={isPending} onClick={() => respond("accepted")}>
                  Accept this proposal
                </Button>
                <Button type="button" size="xl" variant="outline" disabled={isPending} onClick={() => setShowDeclineForm(true)}>
                  Decline
                </Button>
              </div>
            ) : (
              <div className="flex w-full flex-col gap-2">
                <Textarea
                  placeholder="Anything we should know? (optional)"
                  value={decliningNote}
                  onChange={(e) => setDecliningNote(e.target.value)}
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setShowDeclineForm(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex-1"
                    disabled={isPending}
                    onClick={() => respond("declined", decliningNote)}
                  >
                    Confirm decline
                  </Button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : status === "accepted" ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <p className="font-semibold">
              You accepted this proposal{respondedAt ? ` on ${new Date(respondedAt).toLocaleDateString()}` : ""}.
            </p>
            <p className="text-sm text-muted-foreground">We&apos;ll be in touch to schedule the work.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">
              You declined this proposal{respondedAt ? ` on ${new Date(respondedAt).toLocaleDateString()}` : ""}.
            </p>
            <p className="text-sm text-muted-foreground">Feel free to reach out if anything changes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
