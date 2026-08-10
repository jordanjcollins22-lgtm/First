"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateProfileRole } from "@/lib/actions/team-actions";
import type { CustomRole, Role } from "@/types/domain";

export function RoleSelect({
  profileId,
  initialRole,
  roles,
  disabled,
}: {
  profileId: string;
  initialRole: Role;
  roles: CustomRole[];
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(() => updateProfileRole(profileId, value));
  }

  return (
    <Select defaultValue={initialRole} onValueChange={handleChange} disabled={disabled || isPending}>
      <SelectTrigger className="h-9 w-32 text-sm capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.name} value={role.name} className="capitalize">
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
