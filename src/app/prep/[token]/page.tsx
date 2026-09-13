import { notFound } from "next/navigation";

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
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{intake.businessName}</p>
      <h1 className="mt-0.5 text-2xl font-semibold">Before we come out</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {intake.clientFirstName ? `${intake.clientFirstName}, a` : "A"} few questions so we arrive with ideas instead
        of guesses. About five minutes. Nothing here is binding.
      </p>
      {intake.address && <p className="mt-2 text-sm">{intake.address}</p>}
      {intake.evaluationAt && !intake.cancelled && (
        <p className="text-sm text-muted-foreground">{sayWhen(intake.evaluationAt)}</p>
      )}
      {intake.cancelled && (
        <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          This visit was cancelled. If that is a surprise, call or text {intake.businessPhone ?? "us"}.
        </p>
      )}

      <div className="mt-6">
        <IntakeForm
          token={intake.token}
          initial={intake.answers}
          submittedAt={intake.submittedAt}
          together={together === "1"}
          businessPhone={intake.businessPhone}
        />
      </div>
    </main>
  );
}

/** The visit, read as the wall-clock time the booking page wrote. */
function sayWhen(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(at).toLowerCase();
  return `${day} at ${time}`;
}
