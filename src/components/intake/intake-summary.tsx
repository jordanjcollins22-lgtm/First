import Link from "next/link";

import { intakeHeadline, summarizeDetails, summarizeIntake, talkingPoints, type IntakeAnswers } from "@/lib/evaluation-intake";
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
  photos = [],
}: {
  answers: IntakeAnswers;
  submittedAt: string | null;
  submittedBy: "client" | "together" | null;
  token: string;
  photos?: { path: string; url: string }[];
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
  const details = summarizeDetails(answers);
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
      {details.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">For the price</p>
          <dl className="mt-1 grid gap-1.5 sm:grid-cols-[9rem_1fr]">
            {details.map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="m-0">{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((p) => (
            <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-muted">
              {/* Signed links to a private bucket. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="Their photo of the property" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
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
