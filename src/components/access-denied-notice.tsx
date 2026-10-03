import { ShieldAlert } from "lucide-react";

import { TABS } from "@/lib/permissions";

/**
 * Explains a redirect that would otherwise look like a bug.
 *
 * Somebody clicked a link that existed and landed somewhere else. Without this
 * they cannot tell whether they misclicked, the link is broken, or they simply
 * are not allowed — and the third one is the only fixable answer.
 */
export function AccessDeniedNotice({ tab }: { tab: string | undefined }) {
  if (!tab) return null;
  const label = TABS.find((t) => t.key === tab)?.label ?? tab;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50/70 px-3 py-2.5">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <p className="text-xs text-amber-900">
        <span className="font-semibold">{label}</span> isn&apos;t switched on for your role, so you
        were sent here instead. An admin can turn it on under Permissions.
      </p>
    </div>
  );
}
