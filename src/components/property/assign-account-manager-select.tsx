"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignAccountManager } from "@/lib/actions/customer-actions";
import type { Profile } from "@/types/domain";

const UNASSIGNED = "unassigned";

export function AssignAccountManagerSelect({
  customerId,
  initialAccountManagerId,
  profiles,
}: {
  customerId: string;
  initialAccountManagerId: string | null;
  profiles: Profile[];
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(() => assignAccountManager(customerId, value === UNASSIGNED ? null : value));
  }

  return (
    <Select defaultValue={initialAccountManagerId ?? UNASSIGNED} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-40 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>No account manager</SelectItem>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.full_name || profile.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
