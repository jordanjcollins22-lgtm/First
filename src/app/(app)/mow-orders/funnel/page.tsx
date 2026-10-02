import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getMowFunnelData, listMowOrders, periodStart } from "@/lib/data/mow-orders";
import { buildFunnel } from "@/lib/mow-funnel";
import { FunnelScoreboard } from "@/components/mow/funnel-scoreboard";

/** The quick mow funnel scoreboard: clicks to revenue, call speed, and the six levels. */
export const dynamic = "force-dynamic";

export default async function MowFunnelPage({ searchParams }: { searchParams?: Promise<{ days?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("mow-orders", "/sales");
  const profile = await getCurrentProfile();
  const { days: daysParam } = (await searchParams) ?? {};
  const days = daysParam === "all" ? null : daysParam === "7" ? 7 : 30;
  const since = periodStart(days);

  const [orders, data] = await Promise.all([listMowOrders().catch(() => []), getMowFunnelData(since)]);
  const inPeriod = orders.filter((o) => o.createdAt >= since);
  const funnel = buildFunnel({ clicks: data.clicks, checks: data.checks, orders: inPeriod });

  return (
    <FunnelScoreboard
      funnel={funnel}
      days={days}
      alertsOn={data.alertsOn}
      canSwitchAlerts={Boolean(profile && (isOwnerLevel(profile.roles) || profile.roles.includes("admin")))}
      metaConnected={data.metaConnected}
      mowsPerDay={data.mowsPerDay}
    />
  );
}
