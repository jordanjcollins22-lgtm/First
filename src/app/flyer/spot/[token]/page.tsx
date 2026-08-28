import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { FlyerSpotStatus } from "@/components/flyer/flyer-spot-status";

/**
 * An advertiser's own booking, by their link.
 *
 * Where Stripe sends them back to, and where they land if they come back to a
 * half finished one.
 */
export default async function FlyerSpotPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const { paid } = await searchParams;
  if (!isSupabaseConfigured) return <NotValid />;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("flyer_bookings")
    .select("business_name, image_path, status, slot, amount_cents, run_id")
    .eq("token", token)
    .maybeSingle();
  if (!booking) return <NotValid />;

  const { data: run } = await admin
    .from("flyer_runs")
    .select("name, mails_on, flyer_count")
    .eq("id", booking.run_id)
    .maybeSingle();

  const { data: publicUrl } = booking.image_path
    ? admin.storage.from("flyer-ads").getPublicUrl(booking.image_path)
    : { data: { publicUrl: "" } };

  return (
    <FlyerSpotStatus
      token={token}
      businessName={booking.business_name}
      imageUrl={publicUrl.publicUrl}
      status={booking.status}
      amountCents={booking.amount_cents ?? 0}
      runName={run?.name ?? "the next run"}
      mailsOn={run?.mails_on ?? null}
      flyerCount={run?.flyer_count ?? 2500}
      justPaid={paid === "1"}
    />
  );
}

function NotValid() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-lg font-semibold">That link isn&apos;t valid.</p>
      <p className="mt-1 text-sm text-muted-foreground">Double check it, or contact us directly.</p>
    </div>
  );
}
