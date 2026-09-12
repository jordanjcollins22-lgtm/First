"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganization } from "@/lib/actions/organization-actions";

export function CreateOrganizationForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    const name = String(formData.get("name") ?? "");
    const adminEmail = String(formData.get("adminEmail") ?? "");
    const adminPassword = String(formData.get("adminPassword") ?? "");
    startTransition(async () => {
      try {
        await createOrganization({ name, adminEmail, adminPassword });
        setSuccess(`"${name}" created — share ${adminEmail} and the password with its admin directly.`);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-name">Business name</Label>
          <Input id="org-name" name="name" required placeholder="e.g. Acme Landscaping" className="w-56" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-admin-email">Their admin&apos;s email</Label>
          <Input
            id="org-admin-email"
            name="adminEmail"
            type="email"
            required
            placeholder="name@example.com"
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-admin-password">Temporary password</Label>
          <Input
            id="org-admin-password"
            name="adminPassword"
            type="text"
            required
            minLength={6}
            placeholder="At least 6 characters"
            className="w-44"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creating...
            </>
          ) : (
            "Create business"
          )}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-emerald-600">{success}</p>}
    </form>
  );
}
