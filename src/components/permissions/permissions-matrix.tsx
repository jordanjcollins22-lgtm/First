"use client";

import { useState, useTransition } from "react";

import { setRolePermission, setTabOpenToAll } from "@/lib/actions/permissions-actions";
import { TABS } from "@/lib/permissions";
import type { CustomRole, RolePermission } from "@/types/domain";

export function PermissionsMatrix({ roles, permissions }: { roles: CustomRole[]; permissions: RolePermission[] }) {
  const [grants, setGrants] = useState(() => new Set(permissions.map((p) => `${p.role_name}:${p.tab_key}`)));
  const [isPending, startTransition] = useTransition();

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

  /** One page, every role at once. Unticking clears the page back to
   * "undecided", which means admins only until somebody ticks it. */
  function toggleOpenToAll(tab: string, open: boolean) {
    setGrants((prev) => {
      const next = new Set(prev);
      for (const role of roles) {
        const key = `${role.name}:${tab}`;
        if (open) next.add(key);
        else next.delete(key);
      }
      return next;
    });
    startTransition(() => setTabOpenToAll(tab, open));
  }

  const isOpenToAll = (tab: string) => roles.length > 0 && roles.every((r) => grants.has(`${r.name}:${tab}`));
  const isUnconfigured = (tab: string) => roles.every((r) => !grants.has(`${r.name}:${tab}`));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card p-2 font-medium">Role</th>
            {TABS.map((tab) => (
              <th key={tab.key} className="p-2 text-center font-medium">
                {tab.label}
                {isUnconfigured(tab.key) && (
                  <span className="mt-0.5 block text-[9px] font-semibold normal-case text-amber-700">
                    undecided · admin only
                  </span>
                )}
              </th>
            ))}
          </tr>

          {/* Whole-column switch, so opening a page to the team is one tap
              rather than one per role. */}
          <tr className="border-b border-border bg-muted/40 text-left text-xs">
            <th className="sticky left-0 z-10 bg-muted/40 p-2 font-medium normal-case text-muted-foreground">
              Open to all
            </th>
            {TABS.map((tab) => (
              <td key={tab.key} className="p-2 text-center">
                <input
                  type="checkbox"
                  checked={isOpenToAll(tab.key)}
                  disabled={isPending}
                  onChange={(e) => toggleOpenToAll(tab.key, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-label={`Open ${tab.label} to all roles`}
                />
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.name} className="border-b border-border align-middle">
              <td className="sticky left-0 z-10 bg-card p-2 font-medium capitalize">{role.name}</td>
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
