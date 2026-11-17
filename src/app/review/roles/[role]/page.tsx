import Link from "next/link";
import { notFound } from "next/navigation";

import { SendLinkBlock } from "@/components/v2/panels/role/send-link-block";
import { businessToday } from "@/lib/data/compliance";
import { sampleReferrals } from "@/lib/hiring/affiliate-preview";
import { reviewPagesEnabled } from "@/lib/review-pages";

/**
 * Each role's page with sample data, phone-sized, matching the approved
 * phone designs on the Stages of Success poster (technician-phone.png,
 * account-manager-phone.png in the project files). Buttons are switched off.
 * The affiliate's is /review/hiring/affiliate/app.
 */
export const dynamic = "force-dynamic";

const ROLES = {
  technician: { label: "Project technician", hello: "Morning, Alex", slug: "alex-7k2m" },
  "account-manager": { label: "Account manager", hello: "Hi Morgan", slug: "morgan-q8rt" },
} as const;
type RoleKey = keyof typeof ROLES;

export default async function RolePreviewPage({ params }: { params: Promise<{ role: string }> }) {
  if (!reviewPagesEnabled()) notFound();
  const { role } = await params;
  if (!(role in ROLES)) notFound();
  const r = ROLES[role as RoleKey];
  const people = sampleReferrals(businessToday(new Date())).slice(0, 3);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto w-full max-w-md">
        <div className="border-b bg-background px-4 py-2 text-center">
          <span className="rounded-full bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">
            app.jslandscapingmd.com/p/<b className="text-primary">{r.slug}</b>
          </span>
        </div>
        <main className="grid gap-3 px-4 py-4">
          <div className="flex items-baseline justify-between">
            <h1 className="text-2xl font-extrabold">{r.hello}</h1>
            <span className="font-mono text-xs uppercase tracking-wide text-primary">{r.label}</span>
          </div>

          {role === "technician" ? <Technician /> : <AccountManager />}

          <fieldset disabled className="contents [&_button:disabled]:opacity-100">
            <SendLinkBlock people={people} sample={{ step: "start" }} />
          </fieldset>
          <Card>
            <Drop label={<span className="font-semibold">Wallet</span>} value={role === "technician" ? "$742 ready" : "$1,240 ready"} strong />
          </Card>
          {role === "technician" ? (
            <Stages at={4} name="Lead" next="Lead your second morning meeting" />
          ) : (
            <Stages at={2} name="Hire" next="Recruit and keep two new team members for 3 months" />
          )}

          <nav className="flex flex-wrap gap-3 border-t pt-4 text-sm">
            <Link href="/review/roles/technician" className="underline">Project technician</Link>
            <Link href="/review/roles/account-manager" className="underline">Account manager</Link>
            <Link href="/review/hiring/affiliate/app" className="underline">Affiliate</Link>
          </nav>
          <p className="text-xs text-muted-foreground">Preview with sample data. Buttons are switched off.</p>
        </main>
      </div>
    </div>
  );
}

function Technician() {
  return (
    <Card>
      <Button>Clock in · 6:52 am</Button>
      <Title className="mt-4">Today · Crew 2</Title>
      <Rows rows={[["7:30 Miller · mulch 6 yd", "3D model"], ["11:00 Ortiz · bed cleanup", "Zones 1–4"], ["2:00 Lee · edging", "Photos 0/6"]]} />
    </Card>
  );
}

function AccountManager() {
  return (
    <>
      <Card>
        <div className="flex items-baseline justify-between">
          <Title>Do now · 7</Title>
          <span className="font-mono text-xs font-bold text-muted-foreground">1 of 7</span>
        </div>
        <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-primary">Reply</span>
        <p className="mt-1 font-semibold">Miller</p>
        <p className="mt-2 rounded-lg bg-muted px-3 py-2">&quot;What time Tuesday?&quot;</p>
        <p className="mt-2 rounded-lg bg-muted px-3 py-2">Our reply: &quot;Hi! The crew will be there between 7:30 and 8 am Tuesday.&quot;</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button>Approve and send</Button>
          <span className="flex min-h-11 items-center justify-center rounded-lg border-2 border-primary px-3 font-semibold text-primary">Edit</span>
        </div>
        <Divider />
        <Drop label="Not right now" value="1" />
      </Card>

      <Card>
        <Title>Paid visits</Title>
        <Rows rows={[["Today 10 am · Hale · patio", "Paid $199"], ["Today 1 pm · Dunn · drainage", "Paid $99"]]} />
        <div className="mt-2">
          <Button>Start 10 am visit</Button>
        </div>
        <Divider />
        <Drop label="Next 2 weeks" value="5" />
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <Title>Schedule · next 2 weeks</Title>
          <span className="font-mono text-xs font-bold text-muted-foreground">Nov 16 to 27</span>
        </div>
        <p className="mt-1 text-3xl font-extrabold">91% booked</p>
        <p className="text-muted-foreground">146 of 160 crew hours, wait list included</p>
        <Divider />
        <Drop label="Crew 1" value="74 of 80 hrs" />
        <Divider />
        <Drop label="Crew 2" value="46 of 80 hrs" />
        <Divider />
        <Drop label="Wait list" value="2 · 26 hrs" />
      </Card>

      <Card>
        <Title>Hiring</Title>
        <Divider />
        <Drop
          label={
            <span>
              New applicants
              <span className="mt-1 block w-fit rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-amber-800">2 need a call</span>
            </span>
          }
          value="2"
        />
        <Divider />
        <Drop label="Interviews" value="2" />
        <Divider />
        <Drop label="Check-ins due" value="1" />
      </Card>

      <Card>
        <Title>Business</Title>
        <Divider />
        <Drop label="Project review" value="31% profit" />
        <Divider />
        <Drop label="Money in and out" value="+$7,670" />
        <Divider />
        <Drop label="Team promotions" value="1 to approve" />
      </Card>
    </>
  );
}

function Stages({ at, name, next }: { at: number; name: string; next: string }) {
  return (
    <Card>
      <Title>Stages of Success</Title>
      <div className="my-2 flex gap-1" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={"h-2 flex-1 rounded-full " + (i + 1 < at ? "bg-primary" : i + 1 === at ? "bg-lime-500" : "bg-muted")} />
        ))}
      </div>
      <p className="text-muted-foreground">
        Stage {at} of 7: <b className="text-foreground">{name}</b>
      </p>
      <p className="mt-1 text-muted-foreground">Next: {next}</p>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border bg-card p-4 text-sm">{children}</section>;
}

function Title({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={"font-mono text-xs uppercase tracking-widest text-muted-foreground " + className}>{children}</h2>;
}

function Button({ children }: { children: React.ReactNode }) {
  return <span className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-center font-semibold text-primary-foreground">{children}</span>;
}

function Divider() {
  return <div className="my-2 border-t" />;
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="mt-1 divide-y border-t">
      {rows.map(([a, b]) => (
        <li key={a} className="flex items-center justify-between gap-3 py-2">
          <span>{a}</span>
          <b className="shrink-0">{b}</b>
        </li>
      ))}
    </ul>
  );
}

function Drop({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <span className={"shrink-0 font-semibold " + (strong ? "text-foreground" : "text-primary")}>{value} ▾</span>
    </div>
  );
}
