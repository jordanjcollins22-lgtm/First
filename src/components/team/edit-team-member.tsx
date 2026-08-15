"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateTeamMemberDetails, type TeamMemberDetailsInput } from "@/lib/actions/team-actions";
import type { Profile } from "@/types/domain";

/** Admin edit of the details captured when the account was created. Role,
 * pay, and password have their own controls in the row already, so this
 * covers name, contact, and licence. */
export function EditTeamMember({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TeamMemberDetailsInput>({
    firstName: profile.first_name ?? "",
    lastName: profile.last_name ?? "",
    email: profile.email,
    phone: profile.phone ?? "",
    drivesForCompany: profile.drives_for_company,
    licenseNumber: profile.license_number ?? "",
    licenseState: profile.license_state ?? "",
    licenseClass: profile.license_class ?? "",
    licenseExpires: profile.license_expires ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function set(patch: Partial<TeamMemberDetailsInput>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateTeamMemberDetails(profile.id, form);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
      >
        <Pencil className="h-3 w-3" />
        {saved ? "Saved" : "Edit"}
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">First name</Label>
          <Input
            value={form.firstName}
            onChange={(e) => set({ firstName: e.target.value })}
            className="h-9 w-36 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Last name</Label>
          <Input
            value={form.lastName}
            onChange={(e) => set({ lastName: e.target.value })}
            className="h-9 w-36 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            className="h-9 w-56 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Phone</Label>
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder="(555) 123-4567"
            className="h-9 w-40 text-sm"
          />
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={form.drivesForCompany}
          onChange={(e) => set({ drivesForCompany: e.target.checked })}
          className="h-4 w-4"
        />
        Drives for us
      </label>

      {form.drivesForCompany && (
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">License #</Label>
            <Input
              value={form.licenseNumber}
              onChange={(e) => set({ licenseNumber: e.target.value })}
              className="h-9 w-36 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">State</Label>
            <Input
              value={form.licenseState}
              onChange={(e) => set({ licenseState: e.target.value })}
              className="h-9 w-16 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Class</Label>
            <Input
              value={form.licenseClass}
              onChange={(e) => set({ licenseClass: e.target.value })}
              className="h-9 w-16 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Expires</Label>
            <Input
              type="date"
              value={form.licenseExpires}
              onChange={(e) => set({ licenseExpires: e.target.value })}
              className="h-9 w-36 text-sm"
            />
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Changing the email changes how they sign in.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
