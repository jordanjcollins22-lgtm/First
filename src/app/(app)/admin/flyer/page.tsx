import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listFlyerAds } from "@/lib/data/flyer";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { FlyerBuilder } from "@/components/marketing/flyer-builder";
import { listFlyerBusinesses } from "@/lib/data/flyer-outreach";
import { FlyerOutreachList } from "@/components/flyer/outreach-list";

export default async function FlyerPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("flyer");
  if (!allowed) redirect("/admin/tools");

  const [ads, businesses] = await Promise.all([
    listFlyerAds().catch(() => []),
    // Empty until the outreach and business-type migrations run; the list
    // simply shows nobody rather than taking the page down.
    listFlyerBusinesses().catch(() => []),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <FlyerBuilder ads={ads} />
      <div className="mx-auto w-full max-w-3xl px-4 pb-10">
        <FlyerOutreachList businesses={businesses} />
      </div>
    </div>
  );
}
