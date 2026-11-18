"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveApplicantCall } from "@/lib/actions/recording-actions";
import { APPLICANT_CALLS, type ApplicantCall } from "@/lib/hiring/recordings";
import { RecordCall } from "@/components/hiring/record-call";
import type { ApplicantDetail } from "@/lib/data/hiring";
import { shortWhen } from "@/lib/time-zone";
import { interviewGuide } from "@/lib/hiring/interview-guide";
import { Textarea } from "@/components/ui/textarea";

/** Which call is likely next, from where the application is. */
function callFor(stage: string): ApplicantCall {
  if (stage === "owner_talk") return "owner_talk";
  if (stage === "interview" || stage === "working_interview") return "interview";
  return "screening";
}

function length(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Every call with an applicant, recorded and kept here: the screening call,
 * the first interview and the owner call. Moving them on after an interview
 * waits on its recording.
 */
export function ApplicantCalls({ applicant }: { applicant: Pick<ApplicantDetail, "id" | "stage" | "calls" | "position"> }) {
  const router = useRouter();
  const [call, setCall] = useState<ApplicantCall>(callFor(applicant.stage));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  // The recorder hands back the recording from the render it started in, so
  // the notes typed during the call are read fresh when it saves.
  const latest = useRef({ call, notes });
  useEffect(() => {
    latest.current = { call, notes };
  }, [call, notes]);
  const guide = interviewGuide(applicant.position, call);
  const titleOf = (c: string, key: string) => interviewGuide(applicant.position, c as ApplicantCall)?.find((g) => g.key === key)?.title ?? key;

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Calls</h2>
      <p className="text-xs text-muted-foreground">Every interview call is recorded, after you tell them and they say OK. The next step waits on the recording.</p>
      {applicant.calls.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {applicant.calls.map((c, i) => (
            <li key={i} className="space-y-1 px-3 py-2 text-sm">
              <p>
                <span className="font-medium">{c.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {shortWhen(c.at)} · {length(c.seconds)}
                  {c.byName ? ` · ${c.byName}` : ""}
                </span>
              </p>
              {c.url ? <audio controls preload="none" src={c.url} className="h-8 w-full max-w-sm" aria-label={`${c.label} recording`} /> : null}
              {c.notes && (
                <dl className="space-y-1 pt-1 text-xs">
                  {Object.entries(c.notes).map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-semibold">{titleOf(c.call, k)}</dt>
                      <dd className="whitespace-pre-wrap text-muted-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-start gap-2">
        <select
          aria-label="Which call"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={call}
          onChange={(e) => setCall(e.target.value as ApplicantCall)}
        >
          {(Object.keys(APPLICANT_CALLS) as ApplicantCall[]).map((k) => (
            <option key={k} value={k}>
              {APPLICANT_CALLS[k]}
            </option>
          ))}
        </select>
        <RecordCall
          owner="applicant"
          id={applicant.id}
          label={`Record the ${APPLICANT_CALLS[call].toLowerCase()}`}
          onSaved={(r) =>
            start(async () => {
              setError(null);
              const now = latest.current;
              const saved = await saveApplicantCall({ applicantId: applicant.id, call: now.call, path: r.path, seconds: r.seconds, notes: now.notes });
              if (!saved.ok) return setError(saved.message);
              setNotes({});
              router.refresh();
            })
          }
        />
        {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
      {guide && (
        <ol className="space-y-3 border-t border-border pt-3">
          {guide.map((g, i) => (
            <li key={g.key} className="space-y-1.5 text-sm">
              <p className="font-semibold">
                {i + 1}. {g.title}
              </p>
              {g.say && g.say.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Say:</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {g.say.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground">Ask:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {g.ask.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
              {g.listenFor ? <p className="text-xs text-muted-foreground">Listen for: {g.listenFor}</p> : null}
              <Textarea
                rows={2}
                placeholder="Notes"
                aria-label={`Notes: ${g.title}`}
                value={notes[g.key] ?? ""}
                onChange={(e) => setNotes((all) => ({ ...all, [g.key]: e.target.value }))}
              />
            </li>
          ))}
          <li className="text-xs text-muted-foreground">Your notes save with the recording when you tap Stop and save.</li>
        </ol>
      )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
