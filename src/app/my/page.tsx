import Link from "next/link";
import { CalendarDays, ExternalLink, Video } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { currentClient, projectsForClient } from "@/lib/data/client-portal";
import { nextStepFor, stageLabel } from "@/lib/client-portal";
import { ClientSignIn } from "@/components/client/client-sign-in";
import { SignOutLink } from "@/components/client/sign-out-link";

/**
 * A client's own projects.
 *
 * Everything we sent a client used to be a link with a token in it, so coming
 * back a fortnight later meant finding the right email and "can you resend it"
 * was a call the office took over and over. This is the way back in.
 *
 * It shows one customer's work and nothing else. The scoping is not done from
 * anything in the URL — there is no id here to change — but from the account
 * that is signed in.
 */
export const dynamic = "force-dynamic";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function MyPage() {
  if (!isSupabaseConfigured) return <ClientSignIn />;

  const client = await currentClient();
  if (!client) return <ClientSignIn />;

  const projects = await projectsForClient(client.customerId).catch(() => []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hello {client.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projects.length === 0
              ? "Nothing here yet."
              : `${projects.length} project${projects.length === 1 ? "" : "s"} with us.`}
          </p>
        </div>
        <SignOutLink />
      </header>

      {projects.length === 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-4 text-sm">
          <p>We haven&apos;t got any work down against this address yet.</p>
          <Link href="/book" className="mt-2 inline-block text-primary hover:underline">
            Book a free evaluation
          </Link>
        </div>
      )}

      {projects.map((project) => {
        const next = nextStepFor(project);
        return (
          <article key={project.jobId} className="rounded-xl border border-border bg-card/60 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{project.address}</h2>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {stageLabel(project.stage)}
              </span>
            </div>

            {project.evaluationAt && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                {project.digital ? <Video className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                {project.digital ? "Video walkthrough" : "We come to you"} on{" "}
                {new Date(project.evaluationAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}

            {project.totalCost != null && (
              <p className="mt-2 text-sm">
                <span className="font-semibold">{MONEY.format(project.totalCost)}</span>
                {project.outstandingCents > 0 && (
                  <span className="ml-2 text-muted-foreground">
                    {MONEY.format(project.outstandingCents / 100)} still to pay
                  </span>
                )}
              </p>
            )}

            {next && <p className="mt-2 text-sm font-medium text-primary">{next}</p>}

            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {project.proposalToken && (
                <a
                  href={`/proposal/${project.proposalToken}`}
                  className="flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {project.proposalStatus === "accepted" ? "Your quote" : "See your quote"}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {project.progressToken && (
                <a
                  href={`/progress/${project.progressToken}`}
                  className="flex items-center gap-1 text-muted-foreground hover:underline"
                >
                  Progress and photos
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </article>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Signed in as {client.email}. We never set a password — ask for a code whenever you want back in.
      </p>
    </div>
  );
}
