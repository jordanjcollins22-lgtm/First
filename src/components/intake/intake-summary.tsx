import Link from "next/link";

import { intakeHeadline, summarizeIntake, talkingPoints, type IntakeAnswers } from "@/lib/evaluation-intake";
import { intakePath } from "@/lib/data/evaluation-intake";
import { dateShort } from "@/lib/time-zone";

/**
 * What the client told us before the visit, for whoever is walking it.
 *
 * Answers first, then what to do with them. When nothing came back, the
 * one job is to open the form together in the first five to ten minutes,
 * so that is the button.
 */
export function IntakeSummary({
  answers,
  submittedAt,
  submittedBy,
  token,
}: {
  answers: IntakeAnswers;
  submittedAt: string | null;
  submittedBy: "client" | "together" | null;
  token: string;
}) {
  if (!submittedAt) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{intakeHeadline(null, null)}</p>
        <Link
          href={intakePath(token, true)}
          className="inline-flex min-h-10 w-fit items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
        >
          Open the form together
        </Link>
        <p className="text-xs text-muted-foreground">Hand them the phone or read the questions out. Their answers save to this job.</p>
      </div>
    );
  }

  const lines = summarizeIntake(answers);
  const points = talkingPoints(answers);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {submittedBy === "together" ? "Gathered at the door" : "Sent ahead by the client"} on{" "}
        {dateShort(submittedAt)}.{" "}
        <Link href={intakePath(token, true)} className="text-primary underline underline-offset-2">
          Change an answer
        </Link>
      </p>
      <dl className="grid gap-1.5 sm:grid-cols-[9rem_1fr]">
        {lines.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="m-0">{line.value}</dd>
          </div>
        ))}
      </dl>
      {points.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On the walk</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            {points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
