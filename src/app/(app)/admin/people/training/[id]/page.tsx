import { notFound } from "next/navigation";

import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getModule } from "@/lib/data/people";
import { ModuleEditor } from "@/components/people/module-editor";

/** One training module, or a new one when the id is "new". */
export const dynamic = "force-dynamic";

export default async function TrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return <SetupRequiredNotice />;
  await requireTab("people", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { id } = await params;
  if (id === "new") return <ModuleEditor module={null} />;
  const mod = await getModule(profile.organization_id, id).catch(() => null);
  if (!mod) notFound();
  return <ModuleEditor module={mod} />;
}
