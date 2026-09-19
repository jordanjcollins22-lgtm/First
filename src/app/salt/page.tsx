import { isSupabaseAdminConfigured } from "@/lib/env";
import { saltOffer } from "@/lib/actions/public-salt-actions";
import { SaltForm } from "@/components/salt/salt-form";

/**
 * Prepaid ice melt, on one page.
 *
 * No sign-in and no account, because somebody deciding in October whether to
 * prepay a winter is not going to make one. The whole thing is four questions
 * and a card sheet, and every field after the fourth costs bookings.
 */
export const dynamic = "force-dynamic";

export default async function SaltPage() {
  if (!isSupabaseAdminConfigured) return <Closed />;

  const offer = await saltOffer();
  if (!offer) return <Closed />;

  return <SaltForm offer={offer} />;
}

function Closed() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">We are not taking prepaid salt orders right now.</p>
      <p className="text-sm text-muted-foreground">
        Get in touch and we will tell you when the next winter opens up.
      </p>
    </div>
  );
}
