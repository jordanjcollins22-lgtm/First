"use client";

import { useState, useTransition } from "react";

import { setRolePermission } from "@/lib/actions/permissions-actions";
import { TABS, unconfiguredTabKeys } from "@/lib/permissions";
import type { CustomRole, RolePermission } from "@/types/domain";

export function PermissionsMatrix({ roles, permissions }: { roles: CustomRole[]; permissions: RolePermission[] }) {
  const [grants, setGrants] = useState(() => new Set(permissions.map((p) => `${p.role_name}:${p.tab_key}`)));
  const [isPending, startTransition] = useTransition();

  // Pages nobody has ticked or unticked yet. Until someone does, they fall back
  // to the default declared alongside the page, and the header says which.
  const pending = unconfiguredTabKeys(permissions);

  function toggle(role: string, tab: string, checked: boolean) {
    const key = `${role}:${tab}`;
    setGrants((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
    startTransition(() => setRolePermission(role, tab, checked));
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="p-2 font-medium">Role</th>
            {TABS.map((tab) => (
              <th key={tab.key} className="p-2 text-center font-medium">
                {tab.label}
                {pending.has(tab.key) && (
                  <span className="mt-0.5 block text-[9px] font-semibold normal-case text-amber-700">
                    new · {tab.defaultAccess === "everyone" ? "open to all" : "admin only"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.name} className="border-b border-border align-middle">
              <td className="p-2 font-medium capitalize">{role.name}</td>
              {TABS.map((tab) => (
                <td key={tab.key} className="p-2 text-center">
                  <input
                    type="checkbox"
                    checked={grants.has(`${role.name}:${tab.key}`)}
                    disabled={isPending}
                    onChange={(e) => toggle(role.name, tab.key, e.target.checked)}
                    className="h-4 w-4"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
