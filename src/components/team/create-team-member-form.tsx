"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
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
  const [drives, setDrives] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // onSubmit rather than the form action prop: React clears an
    // action-bound form's fields the moment submission starts, so any
    // rejected entry would wipe everything just typed.
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const formData = new FormData(e.currentTarget);
    formData.set("role", role);
    formData.set("pay_type", payType);
    const email = String(formData.get("email") ?? "");

    startTransition(async () => {
      const result = await createTeamMember(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(`Account created for ${email} — share that email and password with them directly.`);
      formRef.current?.reset();
      setRole("crew");
      setPayType("hourly");
      setDrives(false);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-first-name">First name</Label>
          <Input id="new-member-first-name" name="first_name" required placeholder="Jane" className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-last-name">Last name</Label>
          <Input id="new-member-last-name" name="last_name" required placeholder="Doe" className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-member-phone">Phone</Label>
          <Input
            id="new-member-phone"
            name="phone"
            type="tel"
            placeholder="(555) 123-4567"
            className="w-44"
          />
        </div>
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
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input
            type="checkbox"
            name="drives_for_company"
            checked={drives}
            onChange={(e) => setDrives(e.target.checked)}
            className="h-4 w-4"
          />
          Drives for us
        </label>
        {drives && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-license">License #</Label>
              <Input id="new-member-license" name="license_number" placeholder="D1234567" className="w-40" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-license-state">State</Label>
              <Input id="new-member-license-state" name="license_state" placeholder="MD" className="w-20" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-license-class">Class</Label>
              <Input id="new-member-license-class" name="license_class" placeholder="C" className="w-20" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-license-expires">Expires</Label>
              <Input id="new-member-license-expires" name="license_expires" type="date" className="w-40" />
            </div>
          </>
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
