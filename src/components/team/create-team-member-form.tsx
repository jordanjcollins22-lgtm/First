"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTeamMember } from "@/lib/actions/team-actions";
import type { CustomRole, Role } from "@/types/domain";

export function CreateTeamMemberForm({ roles }: { roles: CustomRole[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<Role>("crew");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    formData.set("role", role);
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      try {
        await createTeamMember(formData);
        setSuccess(`Account created for ${email} — share that email and password with them directly.`);
        formRef.current?.reset();
        setRole("crew");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-email">Email</Label>
          <Input
            id="new-member-email"
            name="email"
            type="email"
            required
            placeholder="name@example.com"
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-password">Password</Label>
          <Input
            id="new-member-password"
            name="password"
            type="text"
            required
            minLength={6}
            placeholder="Temporary password"
            className="w-44"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v)}>
            <SelectTrigger id="new-member-role" className="h-11 w-32 capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.name} value={r.name} className="capitalize">
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Adding...
            </>
          ) : (
            "Add team member"
          )}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-emerald-600">{success}</p>}
    </form>
  );
}
