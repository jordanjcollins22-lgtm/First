"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { respondToProposal } from "@/lib/actions/public-proposal-actions";
import { ObjectionsPanel } from "@/components/proposal/objections-panel";
import type { ScopeLine } from "@/lib/objections";
import { postPublicClientMessage } from "@/lib/actions/public-job-message-actions";
import {
  PROPOSAL_ACCEPT_NOTE,
  PROPOSAL_TERMS,
  PROPOSAL_TERMS_TITLE,
  PROPOSAL_TERMS_TITLE_AGREED,
} from "@/lib/proposal-terms";
import { SiteMapImage } from "./site-map-image";
import { MessageThread } from "@/components/job/message-thread";
import type { PublicProposal } from "@/lib/data/public-proposal";
import { displayLabel } from "@/lib/zone-scope";
import { payPath, PREVIEW_BLOCKED } from "@/lib/proposal-flow";
import type { JobMessage, ProposalStatus } from "@/types/domain";

function formatTotal(total: number | null): string {
  if (total == null) return "Contact us for pricing";
  return `$${Math.round(total).toLocaleString()}`;
}

export function ProposalView({
  data,
  token,
  messages,
  preview = false,
}: {
  data: PublicProposal;
  token: string;
  messages: JobMessage[];
  preview?: boolean;
}) {
  const { proposal, propertyAddress, customerName, organizationName, serviceNames } = data;

  /**
   * The service name, repaired if the snapshot holds a raw id.
   *
   * Proposals freeze their wording, so ones generated while custom services
   * failed to resolve still carry `custom-<uuid>`. Rebuilding fixes them; this
   * makes sure no client reads a database id in the meantime.
   */
  function labelFor(stored: string): string {
    return displayLabel(stored, serviceNames[stored] ? { name: serviceNames[stored] } : undefined);
  }
  const [status, setStatus] = useState<ProposalStatus>(proposal.status);
  const [respondedAt, setRespondedAt] = useState(proposal.responded_at);
  const [decliningNote, setDecliningNote] = useState("");
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [senderName, setSenderName] = useState(customerName);
  const router = useRouter();

  function respond(response: "accepted" | "declined", note = "") {
    // Preview opens the client's real proposal on the client's real token,
    // because that is the only honest way to see what they will see. It used
    // to act on it too, so a staff member who tapped Accept to find out what
    // happened accepted on the client's behalf.
    if (preview) {
      setError(PREVIEW_BLOCKED);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await respondToProposal(token, response, note);
        setStatus(response);
        setRespondedAt(new Date().toISOString());
        // Straight on to how they are paying, on its own page. Leaving them
        // on the proposal with a panel underneath let somebody who had
        // already decided scroll back up and talk themselves out of it.
        if (response === "accepted") router.push(payPath(token));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
      }
    });
  }

  if (status === "needs_approval" && !preview) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-16 text-center">
        <p className="text-lg font-semibold">Your proposal is being finalized.</p>
        <p className="text-sm text-muted-foreground">Check back soon, or reach out if you have questions.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      {preview && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-xs font-semibold text-amber-700">
          Internal preview — the client doesn&apos;t see this banner
        </div>
      )}

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

      {proposal.site_image_path && proposal.site_image_transform && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Your property</h2>
          <SiteMapImage
            imagePath={proposal.site_image_path}
            transform={proposal.site_image_transform}
            zones={proposal.scope_snapshot}
          />
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
                <p className="text-sm text-primary">{labelFor(zone.serviceLabel)}</p>
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
        {proposal.discount_amount > 0 && proposal.total_cost != null ? (
          <>
            <p className="text-sm text-muted-foreground line-through">{formatTotal(proposal.total_cost)}</p>
            <p className="text-sm font-medium text-muted-foreground">
              You save {formatTotal(proposal.discount_amount)}
              {proposal.discount_reason && ` — ${proposal.discount_reason}`}
            </p>
            <p className="text-4xl font-bold text-primary">
              {formatTotal(Math.max(0, proposal.total_cost - proposal.discount_amount))}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-muted-foreground">Total investment</p>
            <p className="text-4xl font-bold text-primary">{formatTotal(proposal.total_cost)}</p>
          </>
        )}
      </div>

      {/* Before the terms and the buttons: a client with an unanswered worry
          does not read terms, they close the tab. Most of those worries have
          an answer we already give on the phone. */}
      <ObjectionsPanel
        token={token}
        readOnly={preview}
        disabled={status !== "sent"}
        lines={proposal.scope_snapshot.map<ScopeLine>((zone) => ({
          zoneName: zone.zoneName,
          serviceLabel: labelFor(zone.serviceLabel),
          performedBy: zone.performedBy ?? "own",
          partnerName: zone.partnerName ?? null,
          priceCents: zone.priceCents ?? null,
          priceDerived: zone.priceDerived ?? false,
        }))}
      />

      {/* Between the price and the buttons deliberately. These terms exist
          because work gets added on the day, and a clause a client scrolls
          past after accepting protects nobody. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4">
        <h2 className="text-lg font-semibold">
          {status === "sent" || status === "needs_approval"
            ? PROPOSAL_TERMS_TITLE
            : PROPOSAL_TERMS_TITLE_AGREED}
        </h2>
        <ul className="flex flex-col gap-3">
          {PROPOSAL_TERMS.map((term) => (
            <li key={term.heading}>
              <p className="text-sm font-semibold">{term.heading}</p>
              <p className="text-sm text-muted-foreground">{term.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col items-center gap-3">
        {status === "needs_approval" ? (
          <p className="text-sm text-muted-foreground">
            Not approved yet — the client can&apos;t see or act on this until it&apos;s sent.
          </p>
        ) : status === "sent" ? (
          <>
            {!showDeclineForm ? (
              // Stacked on a phone: two xl buttons side by side pushed Decline
              // off the right edge of a 390px screen, which is most of the
              // screens this page is ever opened on.
              <div className="flex w-full flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  size="xl"
                  className="w-full sm:flex-1"
                  disabled={isPending}
                  onClick={() => respond("accepted")}
                >
                  Accept this proposal
                </Button>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={isPending}
                  onClick={() => setShowDeclineForm(true)}
                >
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
            {!showDeclineForm && (
              <p className="text-center text-xs text-muted-foreground">{PROPOSAL_ACCEPT_NOTE}</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : status === "accepted" ? (
          // Already accepted, so the only thing left is the next step. Kept
          // as one button rather than a panel of choices, because the choices
          // live on their own page where nothing else competes with them.
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <p className="font-semibold">You accepted this proposal. Thank you.</p>
            {proposal.payment_path ? (
              <p className="text-sm text-muted-foreground">
                We have your payment choice and we will be in touch to book you in.
              </p>
            ) : (
              <Button
                type="button"
                size="xl"
                className="w-full"
                onClick={() => {
                  if (preview) setError(PREVIEW_BLOCKED);
                  else router.push(payPath(token));
                }}
              >
                Choose how to pay
              </Button>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
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

      <MessageThread
        title="Questions? Send us a message"
        messages={messages}
        onSend={async (body) => {
          // Read-only in preview: a test message from the office would land
          // in the client's thread looking like it came from them.
          if (preview) return;
          await postPublicClientMessage(token, senderName, body);
        }}
        viewerAuthorType="client"
        showNameField
        nameValue={senderName}
        onNameChange={setSenderName}
        placeholder="Ask us anything about this proposal..."
        emptyLabel="No messages yet — ask us anything."
      />
    </div>
  );
}
