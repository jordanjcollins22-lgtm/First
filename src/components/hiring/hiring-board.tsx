import Link from "next/link";
import { ChevronRight, ExternalLink, Video } from "lucide-react";

import type { ApplicantRow } from "@/lib/data/hiring";
import type { IndeedInviteRow } from "@/lib/data/indeed-invite";
import { POSITIONS, positionFor } from "@/lib/hiring/positions";
import { STAGES, isStage, type Stage } from "@/lib/hiring/screening";
import { shortWhen } from "@/lib/time-zone";
import { IndeedAds } from "@/components/hiring/indeed-ads";

/** The Hiring page itself, given what to show. Kept apart from the loading so it can be previewed with sample applicants. */

const BOARD: Stage[] = ["video_submitted", "video_requested", "interview", "hired", "screened_out", "not_a_fit"];

export type AdCard = { key: string; title: string; body: string; payFields: string; applyUrl: string; needsPay: boolean };

export function HiringBoard({
  applicants,
  ads,
  careersUrl,
  indeedInvites = [],
  hiringInbox,
  positionFilter,
  stageFilter,
}: {
  applicants: ApplicantRow[] | null;
  ads: AdCard[];
  careersUrl: string;
  /** Indeed applicants the app sent our application link to. */
  indeedInvites?: IndeedInviteRow[] | null;
  /** Where Indeed's application emails should go for that to happen. */
  hiringInbox?: string;
  positionFilter?: string;
  stageFilter?: string;
}) {
  const toWatch = (applicants ?? []).filter((a) => a.stage === "video_submitted").sort((a, b) => (a.videoSubmittedAt ?? "").localeCompare(b.videoSubmittedAt ?? ""));
  const shown = (applicants ?? []).filter(
    (a) => (!positionFilter || a.position === positionFilter) && (!stageFilter || a.stage === stageFilter)
  );
  const count = (position: string, stage: Stage) => (applicants ?? []).filter((a) => a.position === position && a.stage === stage).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Hiring</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Applicants answer the questions, the ones who pass send a short video, and you pick who comes in to interview.
          </p>
        </div>
        <a href={careersUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open the careers page <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </header>

      {applicants === null && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Couldn&apos;t load applicants just now. Reload the page.</p>
      )}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Video className="h-4 w-4" /> Videos to watch
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{toWatch.length}</span>
        </h2>
        {toWatch.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No videos waiting. New ones show up here.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {toWatch.map((a) => (
              <ApplicantLine key={a.id} applicant={a} when={a.videoSubmittedAt} />
            ))}
          </ul>
        )}
      </section>

      <IndeedInvites invites={indeedInvites} inbox={hiringInbox} />

      <section className="space-y-2">
        <h2 className="text-base font-semibold">By job</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Job</th>
                {BOARD.map((s) => (
                  <th key={s} className="px-2 py-2 text-center font-medium">
                    {STAGES[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((p) => (
                <tr key={p.key} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{p.title}</td>
                  {BOARD.map((s) => {
                    const n = count(p.key, s);
                    return (
                      <td key={s} className="px-2 py-2 text-center">
                        {n > 0 ? (
                          <Link href={`/admin/hiring?position=${p.key}&stage=${s}#everyone`} className="font-semibold text-primary hover:underline">
                            {n}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="everyone" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {positionFilter || stageFilter
              ? [positionFor(positionFilter ?? "")?.title, stageFilter && isStage(stageFilter) ? STAGES[stageFilter] : null].filter(Boolean).join(" · ")
              : "Everyone who applied"}
          </h2>
          {(positionFilter || stageFilter) && (
            <Link href="/admin/hiring#everyone" className="text-sm text-primary hover:underline">
              Show everyone
            </Link>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {shown.map((a) => (
              <ApplicantLine key={a.id} applicant={a} when={a.createdAt} showStage />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Indeed ads</h2>
        <p className="text-sm text-muted-foreground">
          One per job. Copy the title and the description into Indeed. Each ad links to its own apply page, marked as coming from Indeed.
        </p>
        <IndeedAds ads={ads} />
      </section>
    </div>
  );
}

function ApplicantLine({ applicant, when, showStage }: { applicant: ApplicantRow; when: string | null; showStage?: boolean }) {
  const position = positionFor(applicant.position);
  return (
    <li>
      <Link href={`/admin/hiring/${applicant.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {applicant.name}
            {applicant.rating ? <span className="ml-2 text-xs text-amber-600">{"★".repeat(applicant.rating)}</span> : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[position?.title, showStage ? STAGES[applicant.stage] : null, applicant.source ? `from ${applicant.source}` : null, when ? shortWhen(when) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

const INVITE_STATUS: Record<IndeedInviteRow["status"], string> = {
  sent: "Sent our application link",
  repeat: "Already sent the link for another job",
  no_address: "No address from Indeed: message them on Indeed",
  failed: "Didn't send: message them on Indeed",
};

/** Who applied on Indeed and was sent our application link automatically. */
function IndeedInvites({ invites, inbox }: { invites: IndeedInviteRow[] | null; inbox?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Applied on Indeed</h2>
      <p className="text-sm text-muted-foreground">
        Anyone who applies with Indeed&apos;s own button is emailed the link to our application straight away, no approval needed.
        {inbox ? (
          <>
            {" "}
            Indeed&apos;s email for each new application has to reach <span className="font-medium text-foreground">{inbox}</span> for this to work.
          </>
        ) : null}
      </p>
      {invites === null ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Couldn&apos;t load these just now. Reload the page.</p>
      ) : invites.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nobody yet. Each one shows up here when their link goes.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{i.name ?? "Name not given"}</span>
              <span className="text-xs text-muted-foreground">
                {[positionFor(i.position)?.title ?? i.position, INVITE_STATUS[i.status], shortWhen(i.createdAt)].join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
