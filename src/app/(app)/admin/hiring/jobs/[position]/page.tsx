import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { positionFor } from "@/lib/hiring/positions";
import { RoleDocView } from "@/components/hiring/role-doc-view";

/** One job written down: the role, the Four Rs, a perfect day, the plan, culture and task checklists. */
export default async function JobDocsPage({ params }: { params: Promise<{ position: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("hiring", "/admin");
  const { position: key } = await params;
  const position = positionFor(key);
  const doc = roleDocFor(key);
  if (!position || !doc) notFound();
  return <RoleDocView position={position} doc={doc} />;
}
