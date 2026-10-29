"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Hand } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getOrCreatePreEvalLink } from "@/lib/actions/pre-eval-actions";
import type { PreEvalSummary } from "@/lib/data/pre-evals";
import { PRE_EVAL_PHOTO_BUCKET, UNSURE_SERVICE } from "@/lib/pre-eval";
import { createClient } from "@/lib/supabase/client";
import type { ServiceTemplate } from "@/types/domain";

interface PreEvalPanelProps {
  jobId: string;
  preEval: PreEvalSummary | null;
  serviceTemplates: ServiceTemplate[];
}

/** Job workspace section: copy the client's pre-eval link and see what they sent. */
export function PreEvalPanel({ jobId, preEval, serviceTemplates }: PreEvalPanelProps) {
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    startTransition(async () => {
      const id = preEval?.id ?? (await getOrCreatePreEvalLink(jobId));
      const url = `${window.location.origin}/pre-eval/${id}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        window.prompt("Copy this link for the client:", url);
      }
    });
  }

  const serviceName = (id: string) =>
    id === UNSURE_SERVICE
      ? "Not sure, take a look"
      : serviceTemplates.find((t) => t.id === id)?.name ?? "Service no longer offered";
  const photoUrl = (path: string) =>
    createClient().storage.from(PRE_EVAL_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

  let status = "Send the client this link so they can tap the areas they want worked on.";
  if (preEval?.submittedAt) {
    status = `Sent ${new Date(preEval.submittedAt).toLocaleDateString()}. Orange pins on the map.`;
  } else if (preEval) {
    status = "Link created. The client hasn't sent anything yet.";
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Hand className="h-4 w-4" /> Client pre-eval
        </p>
        <Button type="button" size="sm" variant="secondary" disabled={isPending} onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{status}</p>

      {preEval?.submittedAt &&
        preEval.spots.map((spot, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5">
            <p className="flex items-start gap-2 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
                {i + 1}
              </span>
              {spot.services.map(serviceName).join(", ")}
            </p>
            {spot.photos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {spot.photos.map((path) => (
                  <a key={path} href={photoUrl(path)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(path)} alt="" className="h-16 w-16 rounded object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
