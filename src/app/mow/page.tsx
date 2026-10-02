import { isSupabaseAdminConfigured } from "@/lib/env";
import { MowForm } from "@/components/mow/mow-form";

/**
 * A mow, bought in about a minute from a post's link: type the address, see
 * the lot and its price, pay for the first mow. ?rec= is the tracked link it
 * came from, so the sale counts for the post; ?org= is whose business it is.
 */
export const dynamic = "force-dynamic";

export default async function MowPage({ searchParams }: { searchParams?: Promise<{ org?: string; rec?: string }> }) {
  const { org, rec } = (await searchParams) ?? {};
  if (!isSupabaseAdminConfigured) {
    return (
      <p className="mx-auto max-w-md px-4 py-20 text-center text-lg font-semibold">We&apos;re not taking mows online right now. Give us a call.</p>
    );
  }
  return <MowForm orgSlug={org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null} rec={rec && /^[a-z0-9]{4,12}$/.test(rec) ? rec : null} />;
}
