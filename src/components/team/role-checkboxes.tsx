"use client";

import { useState, useTransition } from "react";

import { addProfileRole, removeProfileRole } from "@/lib/actions/team-actions";
import type { CustomRole, Role } from "@/types/domain";

export function RoleCheckboxes({
  profileId,
  initialRoles,
  roles,
  disabled,
}: {
  profileId: string;
  initialRoles: Role[];
  roles: CustomRole[];
  disabled?: boolean;
}) {
  const [checkedRoles, setCheckedRoles] = useState(() => new Set(initialRoles));
  const [isPending, startTransition] = useTransition();

  function toggle(role: string, checked: boolean) {
    setCheckedRoles((prev) => {
      const next = new Set(prev);
      if (checked) next.add(role);
      else next.delete(role);
      return next;
    });
    startTransition(() => (checked ? addProfileRole(profileId, role) : removeProfileRole(profileId, role)));
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {roles.map((role) => (
        <label key={role.name} className="flex items-center gap-1.5 text-xs capitalize">
          <input
            type="checkbox"
            checked={checkedRoles.has(role.name)}
            disabled={disabled || isPending}
            onChange={(e) => toggle(role.name, e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {role.name}
        </label>
      ))}
    </div>
  );
}
