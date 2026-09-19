import { isSupabaseAdminConfigured } from "@/lib/env";
import { settleTipByToken, tipByToken } from "@/lib/actions/public-tip-actions";
import { TipView } from "@/components/tips/tip-view";

/**
 * Where a finished job's thank-you link lands.
 *
 * No sign-in, because the person holding it has no account and demanding one
 * is how a thank-you becomes an obstacle. The token in the address is the
 * whole authorisation, and it identifies one job the holder already paid for.
 *
 * A link that was turned off, or was never ours, gets the same page: a link
 * somebody revoked must stop working rather than degrade into a thinner view.
 */
export const dynamic = "force-dynamic";

export default async function TipPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const { paid } = await searchParams;

  if (!isSupabaseAdminConfigured) return <NotActive />;

  // Back from the card sheet. Settled here as well as on the webhook, because
  // a webhook thirty seconds behind should not leave somebody looking at a
  // page still asking for money they just sent.
  if (paid) await settleTipByToken(token).catch(() => {});

  const ask = await tipByToken(token).catch(() => null);
  if (!ask) return <NotActive />;

  return <TipView ask={ask} />;
}

function NotActive() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">This link isn&apos;t active.</p>
      <p className="text-sm text-muted-foreground">
        If you meant to leave something for the crew, tell them directly — they would rather hear it
        anyway.
      </p>
    </div>
  );
}
