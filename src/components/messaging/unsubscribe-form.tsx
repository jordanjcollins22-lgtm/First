"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { unsubscribeByToken } from "@/lib/actions/unsubscribe-actions";

/**
 * The unsubscribe, with a button on it.
 *
 * Asking rather than acting on load, because mail clients follow links to
 * check them and a one-click unsubscribe that fires on a prefetch takes
 * somebody off a list they never asked to leave. One press, and it is done.
 */
export function UnsubscribeForm({
  token,
  businessName,
  email,
  alreadyOff,
}: {
  token: string;
  businessName: string;
  email: string | null;
  alreadyOff: boolean;
}) {
  const [done, setDone] = useState(alreadyOff);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <>
        <h1 className="text-lg font-semibold">You are unsubscribed</h1>
        <p className="text-muted-foreground">
          {businessName} will not email {email ?? "you"} again. If you have work booked with us we will still
          reach you about it by phone.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Stop emails from {businessName}?</h1>
      <p className="text-muted-foreground">
        {email ? `We will stop emailing ${email}.` : "We will stop emailing you."} You can tell us to start
        again any time by replying to one of our messages.
      </p>
      {error && <p className="text-destructive">{error}</p>}
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await unsubscribeByToken(token);
            if (result.ok) setDone(true);
            else setError(result.error);
          })
        }
      >
        {isPending ? "Just a moment..." : "Yes, unsubscribe me"}
      </Button>
    </>
  );
}
