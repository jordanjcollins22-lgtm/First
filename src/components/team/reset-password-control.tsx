"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setTeamMemberPassword } from "@/lib/actions/team-actions";

export function ResetPasswordControl({ profileId }: { profileId: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setMessage(null);
    startTransition(async () => {
      try {
        await setTeamMemberPassword(profileId, password);
        setMessage({ text: "Password updated.", isError: false });
        setPassword("");
      } catch (err) {
        setMessage({ text: err instanceof Error ? err.message : "Something went wrong.", isError: true });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          minLength={6}
          className="h-8 w-32 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending || !password}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Set"}
        </Button>
      </div>
      {message && (
        <p className={`text-xs ${message.isError ? "text-destructive" : "text-emerald-600"}`}>{message.text}</p>
      )}
    </form>
  );
}
