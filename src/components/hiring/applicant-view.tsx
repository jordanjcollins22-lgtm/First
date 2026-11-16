import Link from "next/link";
import { ChevronLeft, ExternalLink, Mail, Phone } from "lucide-react";

import type { ApplicantDetail } from "@/lib/data/hiring";
import { positionFor } from "@/lib/hiring/positions";
import { STAGES, nextStages, stageLabel } from "@/lib/hiring/screening";
import { shortWhen } from "@/lib/time-zone";
import { ApplicantReview } from "@/components/hiring/applicant-review";
import { ApplicantCalls } from "@/components/hiring/applicant-calls";

/** One applicant's page, given the applicant. Kept apart from the loading so it can be previewed with a sample. */

const EVENT_LABEL: Record<string, string> = {
  applied: "Applied",
  video_submitted: "Sent their video",
  reviewed: "Reviewed",
  stage_changed: "Moved",
  email_sent: "Emailed",
  skills_answered: "Answered the skills question",
  call_recorded: "Call recorded",
  offer_reply: "Replied to the offer",
};

export function ApplicantView({ applicant }: { applicant: ApplicantDetail }) {
  const position = positionFor(applicant.position);
  if (!position) return null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <Link href="/admin/hiring" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Hiring
      </Link>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{position.title}</p>
        <h1 className="text-2xl font-bold">{applicant.name}</h1>
        <p className="text-sm">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{stageLabel(applicant.stage, applicant.position)}</span>
          <span className="ml-2 text-muted-foreground">
            Applied {shortWhen(applicant.createdAt)}
            {applicant.source ? ` · from ${applicant.source}` : ""} · ZIP {applicant.zip}
          </span>
        </p>
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          <a href={`tel:${applicant.phone}`} className="flex items-center gap-1 text-primary hover:underline">
            <Phone className="h-4 w-4" /> {applicant.phone}
          </a>
          <a href={`mailto:${applicant.email}`} className="flex items-center gap-1 text-primary hover:underline">
            <Mail className="h-4 w-4" /> {applicant.email}
          </a>
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Video</h2>
        {applicant.videoUrl ? (
          <video src={applicant.videoUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black" />
        ) : applicant.videoLink ? (
          <a href={applicant.videoLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-xl border border-border bg-card p-4 text-sm font-medium text-primary hover:underline">
            Watch their video (they sent a link) <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {applicant.stage === "screened_out" ? "Not asked for one: they didn't pass the questions." : "No video yet."}
          </p>
        )}
        <p className="text-xs text-muted-foreground">They were asked: {position.videoPrompt}</p>
      </section>

      {position.skillsQuestion && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Skills question</h2>
          <p className="text-xs text-muted-foreground">They were asked: {position.skillsQuestion}</p>
          {applicant.answers.skills_at ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
              {applicant.skillsVideoUrl ? (
                <video src={applicant.skillsVideoUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-black" />
              ) : (
                <p className="rounded-lg bg-muted/50 p-3 text-muted-foreground">Their recording plays here.</p>
              )}
              <p className="text-xs text-muted-foreground">Look for friendly and natural, not salesy, and their link shared.</p>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              {applicant.stage === "working_interview" ? "Sent. Waiting for their answer." : "Not sent yet. It goes out with \"Send the skills question\" after the first interview."}
            </p>
          )}
        </section>
      )}

      <ApplicantCalls applicant={applicant} />

      <ApplicantReview
        id={applicant.id}
        stage={applicant.stage}
        next={nextStages(applicant.stage)}
        rating={applicant.rating}
        note={applicant.reviewNote ?? ""}
        position={applicant.position}
      />

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Their answers</h2>
        {applicant.screenReasons.length > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Didn&apos;t pass: {applicant.screenReasons.join(", ")}
          </p>
        )}
        <dl className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {position.questions.map((q) => {
            const answer = applicant.answers[q.key];
            const failed = q.passes && !q.passes.includes(answer ?? "");
            return (
              <div key={q.key} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_14rem]">
                <dt className="text-muted-foreground">{q.label}</dt>
                <dd className={`whitespace-pre-wrap ${failed ? "font-semibold text-amber-700" : "font-medium"}`}>
                  {answer === "yes" ? "Yes" : answer === "no" ? "No" : answer ?? "No answer"}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">History</h2>
        <ol className="space-y-1 text-sm">
          {applicant.events.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-40 shrink-0 text-muted-foreground">{shortWhen(e.at)}</span>
              <span>
                {EVENT_LABEL[e.kind] ?? e.kind}
                {e.kind === "stage_changed" && e.detail?.to ? ` to ${STAGES[e.detail.to as keyof typeof STAGES] ?? e.detail.to}` : ""}
                {e.kind === "call_recorded" && typeof e.detail?.label === "string" ? `: ${e.detail.label}` : ""}
                {e.kind === "email_sent" && typeof e.detail?.subject === "string" ? `: ${e.detail.subject}` : ""}
                {e.actorName ? ` by ${e.actorName}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
