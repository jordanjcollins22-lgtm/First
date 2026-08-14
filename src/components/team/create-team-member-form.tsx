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
  const [payType, setPayType] = useState<"hourly" | "commission" | "both">("hourly");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    formData.set("role", role);
    formData.set("pay_type", payType);
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      try {
        await createTeamMember(formData);
        setSuccess(`Account created for ${email} — share that email and password with them directly.`);
        formRef.current?.reset();
        setRole("crew");
        setPayType("hourly");
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-pay-type">Pay</Label>
          <Select value={payType} onValueChange={(v) => setPayType(v as "hourly" | "commission" | "both")}>
            <SelectTrigger id="new-member-pay-type" className="h-11 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="commission">Commission</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(payType === "hourly" || payType === "both") && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-member-pay-rate">$ / hour</Label>
            <Input
              id="new-member-pay-rate"
              name="pay_rate_per_hour"
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              className="w-24"
            />
          </div>
        )}
        {(payType === "commission" || payType === "both") && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-member-commission">% of sale</Label>
            <Input
              id="new-member-commission"
              name="commission_pct"
              type="number"
              step="0.1"
              min={0}
              max={100}
              placeholder="0"
              className="w-24"
            />
          </div>
        )}
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
