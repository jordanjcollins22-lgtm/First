export const TABS = [
  { key: "new-property", label: "New Property (Home)" },
  { key: "project-data", label: "Project Data" },
  { key: "evaluations", label: "My Evaluations" },
  { key: "tools", label: "Tool Database" },
  { key: "materials", label: "Material Database" },
  { key: "services", label: "Services Database" },
  { key: "team", label: "Team Database" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export function tabsAllowedForRoles(roles: string[], permissions: { role_name: string; tab_key: string }[]): Set<string> {
  const allowed = new Set<string>();
  for (const p of permissions) {
    if (roles.includes(p.role_name)) allowed.add(p.tab_key);
  }
  return allowed;
}
