import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { UnsubscribeForm } from "@/components/messaging/unsubscribe-form";

/**
 * Where the unsubscribe link in an email lands.
 *
 * No sign-in, because the person clicking it does not have an account and
 * demanding one is how an unsubscribe link becomes a spam report. The token
 * in the address is the whole authorisation: it identifies one client and
 * lets them change one thing about themselves.
 *
 * It asks before it acts. A link followed by a mail client prefetching it
 * would otherwise unsubscribe somebody who never touched it, which is a real
 * way to lose a client quietly.
 */
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseAdminConfigured) {
    return <Shell><p>This link cannot be checked right now. Please try again later.</p></Shell>;
  }

  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("id, name, email, organization_id")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (!customer) {
    return (
      <Shell>
        <p>This link has expired or was never ours. Nothing has changed.</p>
      </Shell>
    );
  }

  const [{ data: org }, { data: consent }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", customer.organization_id).maybeSingle(),
    admin
      .from("client_consent")
      .select("state")
      .eq("customer_id", customer.id)
      .eq("channel", "email")
      .maybeSingle(),
  ]);

  return (
    <Shell>
      <UnsubscribeForm
        token={token}
        businessName={org?.name ?? "us"}
        email={customer.email}
        alreadyOff={consent?.state === "revoked"}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-6 py-12 text-sm">
      {children}
    </main>
  );
}
