import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { ClockControl } from "@/components/crew/clock-control";
import { Drop, StageCard } from "@/components/v2/panels/role/affiliate-home";
import { AmSection } from "@/components/v2/panels/role/am-parts";
import { CopyLine } from "@/components/v2/panels/role/copy-line";
import { SendLinkBlock } from "@/components/v2/panels/role/send-link-block";
import { WalletCard } from "@/components/v2/panels/role/wallet-card";
import { businessToday } from "@/lib/data/compliance";
import { sampleReferrals, sampleWallet } from "@/lib/hiring/affiliate-preview";
import { POSITIONS } from "@/lib/hiring/positions";
import { reviewPagesEnabled } from "@/lib/review-pages";

/**
 * Each role's page with sample data, phone-sized, its buttons switched off:
 * what a technician, account manager or the owner sees when they open their
 * own link. The affiliate's is /review/hiring/affiliate/app.
 */
export const dynamic = "force-dynamic";

const APP = "https://app.jslandscapingmd.com";
const ROLES = {
  technician: { label: "Project technician", name: "Alex", slug: "alex-7k2m", aff: "a1b2c3d4e5" },
  "account-manager": { label: "Account manager", name: "Morgan", slug: "morgan-q8rt", aff: "f6g7h8j9k0" },
  owner: { label: "Owner", name: "Jordan", slug: "jordan-vd28", aff: "eb3a339c8a" },
} as const;
type RoleKey = keyof typeof ROLES;

export default async function RolePreviewPage({ params }: { params: Promise<{ role: string }> }) {
  if (!reviewPagesEnabled()) notFound();
  const { role } = await params;
  if (!(role in ROLES)) notFound();
  const r = ROLES[role as RoleKey];
  const today = businessToday(new Date());
  const people = sampleReferrals(today);

  let body: React.ReactNode;
  if (role === "technician") {
    const track = POSITIONS.find((p) => p.key === "project-technician")?.growth;
    const stops = [
      { jobId: "s1", sessionId: "s1", name: "Miller", purpose: "Mulch 6 yd", address: "1204 Pine Ct, Bel Air" },
      { jobId: "s2", sessionId: "s2", name: "Ortiz", purpose: "Bed cleanup", address: "88 Grove Rd, Forest Hill" },
      { jobId: "s3", sessionId: "s3", name: "Lee", purpose: "Edging", address: "17 Hall Ln, Fallston" },
    ];
    body = (
      <>
        <section className="rounded-2xl border bg-card p-4 text-sm">
          <Inert>
            <ClockControl open={null} stops={stops.map((s) => ({ jobId: s.jobId, sessionId: s.sessionId, name: s.name }))} />
          </Inert>
          <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">Today</h2>
          <ul className="divide-y">
            {stops.map((s) => (
              <li key={s.sessionId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 font-medium">
                  {s.name} <span className="font-normal text-muted-foreground">· {s.purpose}</span>
                </span>
                <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground">{s.address}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t pt-3">
            <span className="font-semibold">Calendar and map</span>
            <ChevronDown className="h-4 w-4 text-primary" aria-hidden />
          </div>
        </section>
        <Inert>
          <SendLinkBlock people={people} sample={{ step: "start" }} />
        </Inert>
        <Drop title="Wallet" hint="$212 ready">
          <Inert>
            <WalletCard wallet={sampleWallet(today)} />
          </Inert>
        </Drop>
        {track && <StageCard stage={{ done: 0, total: track.stages.length, next: track.stages[0], nextNeedsAManager: true }} />}
      </>
    );
  } else if (role === "account-manager") {
    body = (
      <>
        <Tab>Sales › Pipeline</Tab>
        <AmSection tour="am-book" title="Call and book a visit" count={2} sub="New leads first: ring them, then tap Book to pick the evaluator and the time.">
          <Rows rows={[["Pat Miller", "1204 Pine Ct, Bel Air", "New lead, 20 min ago", "Book"], ["Sam Ortiz", "88 Grove Rd, Forest Hill", "Visit missed: book again", "Rebook"]]} />
        </AmSection>
        <AmSection tour="am-approve" title="Price and approve" count={1} sub="Proposals the evaluators wrote up. Open one, check the price, approve it or change it, then send it.">
          <Rows rows={[["Lee family", "17 Hall Ln, Fallston", "$2,480 · mulch and edging", "Open"]]} />
        </AmSection>
        <Inert>
          <SendLinkBlock people={people} sample={{ step: "start" }} />
        </Inert>
        <PageLink slug={r.slug} />
        <Tab>Admin › Oversight</Tab>
        <AmSection tour="am-messages" title="Client messages" count={1} sub="Clients waiting on an answer, longest wait first. Write back, or tap Dealt with if you rang them.">
          <Rows rows={[["Jamie Brooks", "When are you coming Thursday?", "Waiting 2 h", "Reply"]]} />
        </AmSection>
        <AmSection tour="am-invoices" title="Invoices due" count={1} sub="$640 not paid yet. Cash or check waiting to be picked up comes first.">
          <Rows rows={[["Ortiz", "Invoice #1042", "$640 · due Friday", "Open"]]} />
        </AmSection>
        <AmSection tour="am-clients" title="My clients" count={3} sub="The accounts you look after. Anything wrong on a job comes first.">
          <Rows rows={[["Miller", "Mulch install · this week", "On track", "Open"], ["Lee", "Proposal out", "Waiting on client", "Open"], ["Ortiz", "Bed cleanup · done", "Invoice due", "Open"]]} />
        </AmSection>
        <AmSection tour="am-commission" title="My commission" sub="What you've earned on the clients you manage. Payable is ready; coming is on work still running.">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Payable" value="$318" />
            <Stat label="Coming" value="$174" />
          </div>
        </AmSection>
      </>
    );
  } else {
    const team: [string, string, string, string][] = [
      ["Jace", "Account manager", "jace-hrjv", "b49d3f3c5f"],
      ["Jackson Truhlar", "Project technician", "jackson-nhbe", "jack"],
      ["Dina Burgess", "Affiliate", "dina-k44d", "29f51f3cde"],
    ];
    body = (
      <>
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          The owner sees all four pages (Marketing, Sales, Operations, Admin) with the whole business. This preview shows the owner&apos;s My links screen, under Admin › Team &amp; access.
        </p>
        <Inert>
          <SendLinkBlock people={people} sample={{ step: "start" }} />
        </Inert>
        <PageLink slug={r.slug} />
        <Drop title={`Everyone's links (${team.length})`} hint="Each person's page link and affiliate link">
          <p className="mb-3 text-sm text-muted-foreground">The bold part is what makes each link theirs.</p>
          <ul className="grid gap-4">
            {team.map(([name, label, slug, aff]) => (
              <li key={slug} className="grid gap-2 rounded-xl border p-3">
                <p className="text-sm font-medium">
                  {name} <span className="font-normal text-muted-foreground">· {label}</span>
                </p>
                <p className="text-xs text-muted-foreground">Page</p>
                <CopyLine link={`${APP}/p/${slug}`} personal={slug} />
                <p className="text-xs text-muted-foreground">Affiliate</p>
                <CopyLine link={`${APP}/book?ref=${aff}`} personal={aff} />
              </li>
            ))}
          </ul>
        </Drop>
      </>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-md gap-4 px-4 py-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview with sample data · {r.label}</p>
        <h1 className="text-xl font-extrabold leading-tight">Morning, {r.name}</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {APP}/p/<strong className="text-primary">{r.slug}</strong>
        </p>
      </div>
      {body}
      <nav className="flex flex-wrap gap-3 border-t pt-4 text-sm">
        {(Object.keys(ROLES) as RoleKey[]).map((k) => (
          <Link key={k} href={`/review/roles/${k}`} className="underline">
            {ROLES[k].label}
          </Link>
        ))}
        <Link href="/review/hiring/affiliate/app" className="underline">
          Affiliate
        </Link>
      </nav>
    </main>
  );
}

function PageLink({ slug }: { slug: string }) {
  return (
    <section>
      <h3 className="text-lg font-semibold">Your page</h3>
      <p className="mb-2 text-sm text-muted-foreground">Your own link to this page. Save it to your home screen. It still asks you to sign in.</p>
      <div className="rounded-2xl border bg-card p-4">
        <CopyLine link={`${APP}/p/${slug}`} personal={slug} />
      </div>
    </section>
  );
}

function Tab({ children }: { children: React.ReactNode }) {
  return <p className="pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function Rows({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <ul className="grid gap-2">
      {rows.map(([a, b, c, button]) => (
        <li key={a + b} className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{a}</p>
            <p className="truncate text-muted-foreground">{b}</p>
            <p className="font-medium text-primary">{c}</p>
          </div>
          <span className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground">{button}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function Inert({ children }: { children: React.ReactNode }) {
  return (
    <fieldset disabled className="contents">
      {children}
    </fieldset>
  );
}
