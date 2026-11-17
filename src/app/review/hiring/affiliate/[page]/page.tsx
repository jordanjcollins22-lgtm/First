import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { businessToday } from "@/lib/data/compliance";
import { positionFor } from "@/lib/hiring/positions";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { indeedAd, needsPay } from "@/lib/hiring/indeed-ad";
import { reviewAd } from "@/lib/hiring/ad-review";
import { applicantEmail, welcomeEmail } from "@/lib/hiring/emails";
import { journeyProps } from "@/lib/hiring/journey-props";
import { outboundBaseUrl } from "@/lib/base-url";
import { appUrl } from "@/lib/app-url";
import { previewPage, sampleApplicant, sampleApplicants, sampleJourney, sampleNewHires, samplePayoutRequest, sampleReferrals, sampleWallet, sampleWalletAsked } from "@/lib/hiring/affiliate-preview";
import { referralMessage } from "@/lib/referral-message";
import { trackedLink } from "@/lib/outreach-links";
import { ReferralMessageCard } from "@/components/v2/panels/role/referral-message-card";
import { ReferralList } from "@/components/v2/panels/role/referral-list";
import { Drop, StageCard } from "@/components/v2/panels/role/affiliate-home";
import { WalletCard } from "@/components/v2/panels/role/wallet-card";
import { PayoutRequests } from "@/components/payments/payout-requests";
import { ApplicantCalls } from "@/components/hiring/applicant-calls";
import { RoleDocView } from "@/components/hiring/role-doc-view";
import { PositionView } from "@/components/hiring/position-view";
import { HiringBoard } from "@/components/hiring/hiring-board";
import { ApplicantView } from "@/components/hiring/applicant-view";
import { VideoStep } from "@/components/hiring/video-step";
import { SkillsStep } from "@/components/hiring/skills-step";
import { NewHireJourney } from "@/components/hiring/new-hire-journey";

/** One page of the affiliate preview, with sample data and its buttons switched off. */
export const dynamic = "force-dynamic";

const BUSINESS = "JS Landscaping MD";

export default async function AffiliatePreviewPage({ params }: { params: Promise<{ page: string }> }) {
  if (!reviewPagesEnabled()) notFound();
  const { page: key } = await params;
  const page = previewPage(key);
  const position = positionFor("affiliate");
  const doc = roleDocFor("affiliate");
  if (!page || !position || !doc) notFound();
  const today = businessToday(new Date());

  let body: React.ReactNode;
  if (key === "docs") {
    body = <RoleDocView position={position} doc={doc} />;
  } else if (key === "job") {
    body = (
      <Inert>
        <PositionView position={position} orgName={BUSINESS} keep={{ org: null, src: null, inv: null }} />
      </Inert>
    );
  } else if (key === "board") {
    const base = await outboundBaseUrl();
    const applyUrl = appUrl(base, `/careers/${position.key}?src=indeed`);
    const ad = indeedAd(position, { business: BUSINESS, area: "Harford County, Maryland", applyUrl });
    const ads = [{ key: position.key, ...ad, applyUrl, needsPay: needsPay(position), checks: reviewAd(position, ad.body) }];
    body = <HiringBoard applicants={sampleApplicants(today)} ads={ads} careersUrl={appUrl(base, "/careers")} newHires={sampleNewHires(today)} positionFilter="affiliate" />;
  } else if (key === "video") {
    body = (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-6">
        <header>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {BUSINESS} · {position.title}
          </p>
          <h1 className="text-2xl font-bold leading-tight">You&apos;re a fit, Dana. One more step</h1>
        </header>
        <Inert>
          <VideoStep token="preview" prompt={position.videoPrompt} alreadyIn={false} businessName={BUSINESS} remote={position.remoteInterviews} />
        </Inert>
      </main>
    );
  } else if (key === "skills") {
    body = (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-6">
        <header>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {BUSINESS} · {position.title}
          </p>
          <h1 className="text-2xl font-bold leading-tight">One question, Dana</h1>
        </header>
        <Inert>
          <SkillsStep token="preview" question={position.skillsQuestion ?? ""} alreadyIn={false} businessName={BUSINESS} />
        </Inert>
      </main>
    );
  } else if (key === "applicant") {
    body = (
      <Inert>
        <ApplicantView applicant={sampleApplicant(today)} />
      </Inert>
    );
  } else if (key === "emails") {
    const common = { firstName: "Dana", positionTitle: position.title, business: BUSINESS, phone: "(410) 555-0100", sender: "Jordan", remote: position.remoteInterviews };
    const emails = [
      { when: "After they pass the questions (step 2)", ...applicantEmail({ ...common, kind: "video_request", videoUrl: "[their video link]" }) },
      { when: "First interview invite, a phone or video call (step 3)", ...applicantEmail({ ...common, kind: "interview", when: "Tue, 10:00 AM", place: null }) },
      {
        when: "The skills question (step 4)",
        ...applicantEmail({ ...common, kind: "skills_question", skillsQuestion: position.skillsQuestion, skillsUrl: "[their answer link]" }),
      },
      { when: "The offer (step 7)", ...applicantEmail({ ...common, kind: "offer", pay: position.commission, positionKey: position.key }) },
      { when: "Sent by itself when they reply \"I accept\" (steps 8 and 9)", ...welcomeEmail({ ...common, positionKey: position.key }) },
    ];
    body = (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-bold">Emails an affiliate gets</h1>
        {emails.map((e) => (
          <section key={e.when} className="rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{e.when}</p>
            <p className="mt-2 font-semibold">Subject: {e.subject}</p>
            <p className="mt-2 whitespace-pre-line">{e.body}</p>
          </section>
        ))}
      </main>
    );
  } else if (key === "new-hire") {
    const props = journeyProps(sampleJourney(today), ["Casey Sample", "Taylor Example"]);
    if (!props) notFound();
    body = (
      <Inert>
        <NewHireJourney {...props} />
      </Inert>
    );
  } else if (key === "guides") {
    const sample = sampleApplicant(today);
    body = (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">Interview call guides</h1>
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Step 3: first interview</p>
          <Inert>
            <ApplicantCalls applicant={{ id: sample.id, position: sample.position, stage: "interview", calls: [] }} />
          </Inert>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Step 5: owner call</p>
          <Inert>
            <ApplicantCalls applicant={{ id: sample.id, position: sample.position, stage: "owner_talk", calls: [] }} />
          </Inert>
        </div>
      </main>
    );
  } else if (key === "app") {
    const link = trackedLink(await outboundBaseUrl(), "k7m2qx9");
    const message = referralMessage({ name: "Pat Miller", affiliation: "neighbor", link, business: BUSINESS, from: "Morgan Sample" });
    body = (
      <main className="mx-auto grid w-full max-w-md gap-4 px-4 py-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">The affiliate&apos;s app, top to bottom</p>
          <h1 className="text-lg font-extrabold leading-tight">1. Send your link to someone</h1>
          <p className="text-sm text-muted-foreground">One button, then one question per screen. They end with a message to copy and send, with their own tracked link on its own line.</p>
        </div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">1. They tap the button</p>
        <Inert>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">1. Send your link to someone</p>
            <ReferralMessageCard sample={{ step: "start" }} />
          </div>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2. Type their name, then Next</p>
        <Inert>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">1. Send your link to someone</p>
            <ReferralMessageCard sample={{ step: "name", name: "Pat Miller" }} />
          </div>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">3. Pick how they know them, then Next</p>
        <Inert>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">1. Send your link to someone</p>
            <ReferralMessageCard sample={{ step: "how", name: "Pat Miller", affiliation: "neighbor" }} />
          </div>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">4. A screenshot if they have one (optional), then Submit</p>
        <Inert>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">1. Send your link to someone</p>
            <ReferralMessageCard sample={{ step: "shot", name: "Pat Miller", affiliation: "neighbor", shotName: "post.png" }} />
          </div>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">5. Copy and send</p>
        <Inert>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">1. Send your link to someone</p>
            <ReferralMessageCard sample={{ step: "message", name: "Pat Miller", affiliation: "neighbor", message }} />
          </div>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2. People you sent it to (closed until they tap)</p>
        <Drop title="People you sent it to" hint={`${sampleReferrals(today).length} sent · 1 sold`} open>
          <ReferralList rows={sampleReferrals(today)} titled={false} />
        </Drop>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">3. Wallet (closed until they tap)</p>
        <Inert>
          <Drop title="Wallet" hint="$212 ready" open>
            <WalletCard wallet={sampleWallet(today)} />
          </Drop>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">After they tap Request payout</p>
        <Inert>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <WalletCard wallet={sampleWalletAsked(today)} />
          </div>
        </Inert>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">4. Their stage</p>
        <StageCard stage={{ done: 3, total: 7, next: "A client you sent leaves us a review", nextNeedsAManager: true }} />
        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">The office&apos;s side, on the Money page</p>
        <Inert>
          <PayoutRequests requests={[samplePayoutRequest(today)]} />
        </Inert>
      </main>
    );
  } else {
    notFound();
  }

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <Link href="/review/hiring/affiliate" className="flex items-center gap-1 font-medium hover:underline">
            <ChevronLeft className="h-4 w-4" /> All affiliate pages
          </Link>
          <span>
            Steps {page.steps.map((s) => s.id).join(", ")} · sample data, nothing saves
          </span>
        </div>
      </div>
      {body}
    </>
  );
}

/** Shows a page as it is, with every button and field switched off. */
function Inert({ children }: { children: React.ReactNode }) {
  return (
    <fieldset disabled className="contents">
      {children}
    </fieldset>
  );
}
