import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getMetaSetup, listMetaPages, listMetaThreads } from "@/lib/data/meta";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MetaAdmin } from "@/components/meta/meta-admin";

/**
 * Facebook & Instagram: the business's own Meta app, the pages it connects,
 * and one inbox for every page's Messenger and Instagram messages.
 *
 * The Meta app is made once on developers.facebook.com. After that, a new page
 * is "Connect Facebook" (or "Refresh pages") here, never a key pasted into
 * Vercel, so twenty pages cost what one did.
 */
export const dynamic = "force-dynamic";

export default async function MetaPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; warning?: string; connected?: string; failed?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("meta", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const orgId = profile.organization_id;
  const query = (await searchParams) ?? {};

  const [setup, pages, threads, baseUrl] = await Promise.all([
    getMetaSetup(orgId),
    listMetaPages(orgId),
    listMetaThreads(orgId),
    outboundBaseUrl(),
  ]);
  const base = baseUrl.replace(/\/$/, "");

  let notice: { tone: "good" | "bad"; text: string } | null = null;
  if (query.error) notice = { tone: "bad", text: query.error };
  else if (query.warning) notice = { tone: "bad", text: query.warning };
  else if (query.connected) {
    const failed = Number(query.failed ?? 0);
    notice = {
      tone: failed ? "bad" : "good",
      text: `Connected ${query.connected} page${query.connected === "1" ? "" : "s"}.${failed ? ` ${failed} couldn't switch on messages; see the page list.` : " Messages are switched on."}`,
    };
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Facebook & Instagram</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your pages once, choose what each one is for, and answer every page&apos;s Messenger and
          Instagram messages from here.
        </p>
      </header>
      <MetaAdmin
        setup={setup}
        pages={pages}
        threads={threads}
        canManage={isOwnerLevel(profile.roles)}
        redirectUri={`${base}/api/meta/callback`}
        webhookUrl={`${base}/api/webhooks/meta`}
        privacyUrl={`${base}/privacy`}
        bookingUrl={`${base}/book`}
        notice={notice}
      />
    </div>
  );
}
