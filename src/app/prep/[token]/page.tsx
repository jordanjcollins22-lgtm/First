import { notFound } from "next/navigation";
import { dayOnly, timeOnly } from "@/lib/time-zone";

import { isSupabaseConfigured } from "@/lib/env";
import { getIntakeByToken } from "@/lib/data/evaluation-intake";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { IntakeForm } from "@/components/intake/intake-form";

/**
 * The pre-evaluation form, from the link in the booking email.
 *
 * Also the page the evaluator opens at the door when the client never got
 * to it: ?together=1 marks the answers as gathered on the visit rather than
 * sent ahead, and changes nothing else.
 */
export const dynamic = "force-dynamic";

export default async function PrepPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ together?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const { together } = (await searchParams) ?? {};
  const intake = await getIntakeByToken(token);
  if (!intake) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-4">
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{intake.businessName}</p>
        <h1 className="text-lg font-semibold">Before we come out</h1>
        {(intake.address || (intake.evaluationAt && !intake.cancelled)) && (
          <p className="truncate text-xs text-muted-foreground">
            {[intake.address, intake.evaluationAt && !intake.cancelled ? sayWhen(intake.evaluationAt) : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>
      {intake.cancelled && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          This visit was cancelled. If that is a surprise, call or text {intake.businessPhone ?? "us"}.
        </p>
      )}

      <IntakeForm
        token={intake.token}
        initial={intake.answers}
        initialPhotos={intake.photoUrls}
        submittedAt={intake.submittedAt}
        together={together === "1"}
        businessPhone={intake.businessPhone}
        greeting={`${intake.clientFirstName ? `${intake.clientFirstName}, a` : "A"} few quick questions, one at a time, so we arrive with ideas instead of guesses. Nothing here is binding.`}
      />
    </main>
  );
}

/** The visit on the business clock, which is the client's clock too. */
function sayWhen(iso: string): string {
  return `${dayOnly(iso)} at ${timeOnly(iso).toLowerCase()}`;
}
