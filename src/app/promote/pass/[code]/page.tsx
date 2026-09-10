import { passByCode } from "@/lib/actions/public-group-pass-actions";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * The business's own pass.
 *
 * Where Stripe sends them back to, and the page they keep. The code is the
 * whole of it: they post whenever they like and send it to an admin.
 */
export const dynamic = "force-dynamic";

export default async function GroupPassPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!isSupabaseConfigured) return <NotValid />;

  const pass = await passByCode(code).catch(() => null);
  if (!pass || !pass.ok) return <NotValid />;

  const paid = pass.status === "paid" || pass.status === "used";
  const expires = pass.expiresAt
    ? new Date(pass.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-12 text-center">
      {paid ? (
        <>
          <h1 className="text-2xl font-bold">You&apos;re good to post.</h1>
          <p className="text-sm text-muted-foreground">
            {pass.businessName} can post once in {pass.groupName}
            {expires ? `, any time before ${expires}` : ""}. Send this code with your post and
            we&apos;ll approve it.
          </p>
          <p className="rounded-lg border border-border px-6 py-4 font-mono text-3xl font-bold tracking-[0.2em]">
            {pass.code.toUpperCase()}
          </p>
          {pass.groupUrl && (
            <a href={pass.groupUrl} className="text-sm underline" target="_blank" rel="noreferrer">
              Open the group
            </a>
          )}
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Not paid yet.</h1>
          <p className="text-sm text-muted-foreground">
            {pass.businessName}&apos;s post in {pass.groupName} costs {pass.amountLabel}. Nothing is
            held until it is paid. If you have just paid, give it a moment and refresh.
          </p>
        </>
      )}
    </div>
  );
}

function NotValid() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">That link isn&apos;t valid</h1>
      <p className="text-sm text-muted-foreground">Check the link, or get in touch with us.</p>
    </div>
  );
}
