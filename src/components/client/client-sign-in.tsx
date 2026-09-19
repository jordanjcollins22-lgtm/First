"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Mail } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sendClientCode, verifyClientCode } from "@/lib/actions/client-auth-actions";
import { cleanCode, codeLooksComplete, looksLikeEmail } from "@/lib/client-portal";

/**
 * Signing in with an emailed code, and no password anywhere.
 *
 * There is nothing to choose, nothing to forget, and nothing worth stealing:
 * a code is good once and for about an hour. For somebody who books a
 * landscaper twice a year, a password is a thing they would reset every time.
 */
export function ClientSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    if (!looksLikeEmail(email)) return setError("That doesn't look like an email address.");
    startTransition(async () => {
      const result = await sendClientCode(email);
      if (result.ok) setSent(result.message);
      else setError(result.error);
    });
  }

  function verify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyClientCode(email, code);
      if (!result.ok) return setError(result.error);
      // A member of staff who signs in here belongs in the app, not on a
      // client page.
      router.replace(result.message === "staff" ? "/dashboard" : "/my");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold">Your projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your quotes, your visits and where the work has got to. No password — we email you a code.
        </p>
      </div>

      {!sent ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">The email you booked with</span>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              className="h-12 text-base"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" className="h-12" disabled={pending} onClick={send}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Email me a code
          </Button>
        </>
      ) : (
        <>
          <p className="rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm text-muted-foreground">
            {sent}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">The six-digit code</span>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(cleanCode(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && codeLooksComplete(code) && verify()}
              className="h-12 text-center text-2xl tracking-[0.4em]"
              placeholder="000000"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="button"
            className="h-12"
            disabled={pending || !codeLooksComplete(code)}
            onClick={verify}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            Sign in
          </Button>
          <button
            type="button"
            onClick={() => {
              setSent(null);
              setCode("");
              setError(null);
            }}
            className="text-sm text-muted-foreground underline"
          >
            Use a different email
          </button>
        </>
      )}
    </div>
  );
}
