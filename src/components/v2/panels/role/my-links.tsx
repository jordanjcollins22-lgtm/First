import { AffiliateLinkCard } from "@/components/v2/panels/role/affiliate-link-card";
import { CopyLine } from "@/components/v2/panels/role/copy-line";
import { ReferralMessageCard } from "@/components/v2/panels/role/referral-message-card";
import { ReferralList } from "@/components/v2/panels/role/referral-list";
import { Drop } from "@/components/v2/panels/role/affiliate-home";
import { appUrl } from "@/lib/app-url";
import { outboundBaseUrl } from "@/lib/base-url";
import { myBookingLink } from "@/lib/data/brought-in";
import { myDashboardLink } from "@/lib/data/personal-link";
import { myReferrals } from "@/lib/data/referrals";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { dashboardPath } from "@/lib/personal-link";
import { qrSvg } from "@/lib/qr";
import { v2RolesOf } from "@/lib/v2-roles";
import type { Profile } from "@/types/domain";

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner",
  "account-manager": "Account manager",
  "project-technician": "Project technician",
  "project-lead": "Project technician",
  evaluator: "Evaluator",
  affiliate: "Affiliate",
};

/**
 * Everybody's two links, for technicians, account managers and the owner
 * (an affiliate's home has the same at its top).
 *
 * 1. Your page: their own link to this page. It still asks them to sign in.
 * 2. Send your link to someone: the affiliate block, because every technician
 *    and up has an affiliate link and earns the same 4% on what it brings in.
 *
 * The owner also gets everyone's two links, to hand each person theirs.
 */
export async function MyLinksPanel() {
  const profile = await getCurrentProfile();
  if (!profile) return <Box>Sign in again to see your links.</Box>;
  const baseUrl = await outboundBaseUrl().catch(() => "");
  const [page, link, sent] = await Promise.all([
    myDashboardLink(profile, baseUrl).catch(() => null),
    myBookingLink(profile, baseUrl).catch(() => null),
    myReferrals(profile.organization_id, profile.id),
  ]);
  const qr = link ? await qrSvg(link, 256).catch(() => null) : null;
  const isOwner = v2RolesOf(profile).includes("owner");

  return (
    <div className="mx-auto grid w-full max-w-md gap-5">
      <section aria-labelledby="my-page-link">
        <h3 id="my-page-link" className="text-lg font-semibold">Your page</h3>
        <p className="mb-2 text-sm text-muted-foreground">Your own link to this page. Save it to your home screen. It still asks you to sign in.</p>
        <Box>
          {page ? <CopyLine link={page} personal={page.split("/p/")[1]} /> : <p className="text-sm text-muted-foreground">Your page link isn&apos;t set up yet.</p>}
        </Box>
      </section>

      <section aria-labelledby="my-aff-link">
        <h3 id="my-aff-link" className="text-lg font-semibold">Send your link to someone</h3>
        <p className="mb-2 text-sm text-muted-foreground">Neighbors, friends, anyone who needs yard work. Say who it&apos;s for and how you know them. You get 4% of every job it brings in, once the client pays.</p>
        <Box>
          <ReferralMessageCard />
        </Box>
        <div className="mt-3 grid gap-3">
          <Drop title={`People you sent it to (${sent.length})`}>
            {sent.length > 0 ? <ReferralList rows={sent} titled={false} /> : <p className="text-sm text-muted-foreground">Nobody yet. Everyone you send your link to shows up here, with whether they opened it.</p>}
          </Drop>
          <details className="rounded-2xl border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">Just your link, or a QR code</summary>
            <div className="mt-3">
              <AffiliateLinkCard link={link} qrSvg={qr} />
            </div>
          </details>
        </div>
      </section>

      {isOwner && <EveryonesLinks baseUrl={baseUrl} organizationId={profile.organization_id} />}
    </div>
  );
}

async function EveryonesLinks({ baseUrl, organizationId }: { baseUrl: string; organizationId: string }) {
  const team = (await listProfiles().catch(() => [] as Profile[])).filter((p) => p.organization_id === organizationId);
  const rows = team
    .map((p) => ({ p, roles: v2RolesOf(p) }))
    .filter(({ roles }) => roles.length > 0)
    .sort((a, b) => (a.p.full_name || a.p.email).localeCompare(b.p.full_name || b.p.email));
  return (
    <Drop title={`Everyone's links (${rows.length})`} hint="Each person's page link and affiliate link">
      <p className="mb-3 text-sm text-muted-foreground">The bold part is what makes each link theirs. The page link still asks them to sign in. The affiliate link is the one they send to clients.</p>
      <ul className="grid gap-4">
        {rows.map(({ p, roles }) => (
          <li key={p.id} className="grid gap-2 rounded-xl border p-3">
            <p className="text-sm font-medium">
              {p.full_name || p.email} <span className="font-normal text-muted-foreground">· {[...new Set(roles.map((r) => ROLE_NAMES[r]))].join(", ")}</span>
            </p>
            <p className="text-xs text-muted-foreground">Page</p>
            {p.dashboard_slug ? <CopyLine link={appUrl(baseUrl, dashboardPath(p.dashboard_slug))} personal={p.dashboard_slug} /> : <p className="text-sm text-muted-foreground">Not made yet: it is made the first time they open their page.</p>}
            <p className="text-xs text-muted-foreground">Affiliate</p>
            {p.affiliate_slug ? <CopyLine link={appUrl(baseUrl, `/book?ref=${p.affiliate_slug}`)} personal={p.affiliate_slug} /> : <p className="text-sm text-muted-foreground">Not made yet: it is made the first time they open their page.</p>}
          </li>
        ))}
      </ul>
    </Drop>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-card p-4">{children}</div>;
}
