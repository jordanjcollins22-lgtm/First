"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Mail } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { sendLoginCode, verifyLoginCode } from "@/lib/actions/auth-actions";
import { cleanCode, codeLooksComplete, looksLikeEmail } from "@/lib/client-portal";

/**
 * Signing in with an emailed code, for the team.
 *
 * Same as the client door: no password to forget, reset or leak. A code
 * is good once and for about an hour, and comes to the address on the
 * account, which is the one thing a stranger does not have.
 */
export function CodeLoginForm() {
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
      const result = await sendLoginCode(email);
      if (result.ok) setSent(result.message);
      else setError(result.error);
    });
  }

  function verify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyLoginCode(email, code);
      if (!result.ok) return setError(result.error);
      router.replace(result.message === "client" ? "/my" : "/");
      router.refresh();
    });
  }

  if (!sent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            className="h-12 text-base"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" size="xl" className="w-full" disabled={pending} onClick={send}>
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-5 w-5" />}
          Email me a code
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm text-muted-foreground">{sent}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">The six-digit code</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(e) => setCode(cleanCode(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && codeLooksComplete(code) && verify()}
          className="h-12 text-center text-2xl tracking-[0.4em]"
          placeholder="000000"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" size="xl" className="w-full" disabled={pending || !codeLooksComplete(code)} onClick={verify}>
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
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
    </div>
  );
}
