"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { approveDraft, discardDraft } from "@/lib/actions/inbox-actions";
import type { Draft } from "@/lib/data/inbox";

import { CHANNEL_LABEL } from "./channels";

export function DraftCard({ draft }: { draft: Draft }) {
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: (fd: FormData) => Promise<{ error?: string }>) {
    const fd = new FormData();
    fd.set("id", draft.id);
    fd.set("body", body);
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result.error) setError(result.error);
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">
            {draft.contact_name ?? draft.contact_address ?? "Customer"}
            {draft.contact_name && draft.contact_address && (
              <span className="font-normal text-muted-foreground"> · {draft.contact_address}</span>
            )}
          </p>
          <Badge variant="outline">{CHANNEL_LABEL[draft.channel] ?? draft.channel}</Badge>
        </div>
        {draft.in_reply_to && (
          <p className="rounded-md bg-muted px-3 py-2">
            <span className="text-muted-foreground">They said: </span>
            {draft.in_reply_to}
          </p>
        )}
        {draft.note && <p className="text-muted-foreground">Flagged: {draft.note}</p>}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Reply" />
        {error && <p className="text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" disabled={isPending || !body.trim()} onClick={() => run(approveDraft)}>
            Send
          </Button>
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => run(discardDraft)}>
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
