import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listFlyerAds } from "@/lib/data/flyer";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { FlyerBuilder } from "@/components/marketing/flyer-builder";

export default async function FlyerPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("flyer");
  if (!allowed) redirect("/admin/tools");

  const ads = await listFlyerAds().catch(() => []);

  return <FlyerBuilder ads={ads} />;
}
