import { isSupabaseConfigured } from "@/lib/env";
import { openFlyerRun } from "@/lib/data/public-flyer";
import { FlyerFunnel } from "@/components/flyer/flyer-funnel";

/**
 * The whole pitch and the whole purchase, on one page.
 *
 * A local business is not going to make an account, learn a dashboard, or
 * come back tomorrow. What it costs, what they get, upload, look at it, pay.
 */
export default async function FlyerOfferPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isSupabaseConfigured) return <NotRunning />;

  const run = await openFlyerRun(slug);
  if (!run) return <NotRunning />;

  return <FlyerFunnel run={run} slug={slug} />;
}

function NotRunning() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-lg font-semibold">No flyer run is open right now.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Get in touch and we will tell you when the next one goes out.
      </p>
    </div>
  );
}
