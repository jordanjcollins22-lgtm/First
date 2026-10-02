"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { previewApplicantEmail, saveApplicantReview, sendApplicantEmail, setApplicantStage } from "@/lib/actions/hiring-actions";
import type { ApplicantEmailKind } from "@/lib/hiring/emails";
import type { Stage } from "@/lib/hiring/screening";

type Draft = { kind: ApplicantEmailKind; to: string; subject: string; body: string; interviewAt: string | null };

const EMAIL_FOR: Partial<Record<Stage, { kind: ApplicantEmailKind; label: string }>> = {
  interview: { kind: "interview", label: "Invite to interview" },
  not_a_fit: { kind: "not_a_fit", label: "Not a fit" },
  video_requested: { kind: "video_request", label: "Ask for a video anyway" },
};

const QUIET_LABEL: Partial<Record<Stage, string>> = {
  hired: "Mark hired",
  withdrawn: "They withdrew",
  not_a_fit: "Not a fit, without emailing",
  video_requested: "Allow a video, without emailing",
};

/**
 * What you thought of them, and what happens next. An email is always shown
 * word for word, can be changed, and goes only on Send.
 */
export function ApplicantReview({ id, stage, next, rating, note }: { id: string; stage: Stage; next: Stage[]; rating: number | null; note: string }) {
  const router = useRouter();
  const [stars, setStars] = useState<number | null>(rating);
  const [text, setText] = useState(note);
  const [interviewAt, setInterviewAt] = useState("");
  const [place, setPlace] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const say = (ok: boolean, text: string) => setMessage({ ok, text });

  function save() {
    start(async () => {
      const result = await saveApplicantReview({ id, rating: stars, note: text });
      say(result.ok, result.ok ? "Saved." : result.message);
      if (result.ok) router.refresh();
    });
  }

  function preview(kind: ApplicantEmailKind) {
    setMessage(null);
    start(async () => {
      const result = await previewApplicantEmail({ id, kind, interviewAt: kind === "interview" ? interviewAt : null, place });
      if (!result.ok) return say(false, result.message);
      setDraft({ kind, to: result.to, subject: result.subject, body: result.body, interviewAt: kind === "interview" ? interviewAt : null });
    });
  }

  function send() {
    if (!draft) return;
    start(async () => {
      const result = await sendApplicantEmail({ id, kind: draft.kind, subject: draft.subject, body: draft.body, interviewAt: draft.interviewAt });
      if (!result.ok) return say(false, result.message);
      setDraft(null);
      say(true, result.message ?? "Sent.");
      router.refresh();
    });
  }

  function quiet(to: Stage) {
    start(async () => {
      const result = await setApplicantStage({ id, stage: to });
      if (!result.ok) return say(false, result.message);
      say(true, "Done.");
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Your review</h2>
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => setStars(stars === n ? null : n)}
              className="rounded p-1 hover:bg-muted"
            >
              <Star className={`h-6 w-6 ${stars && n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
            </button>
          ))}
        </div>
        <Textarea rows={3} placeholder="What stood out, good or bad" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={save}>
          Save review
        </Button>
      </div>

      {next.length > 0 && !draft && (
        <div className="space-y-3 border-t border-border pt-4">
          <h2 className="text-base font-semibold">Next step</h2>
          {next.includes("interview") && (
            <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Interview day and time
                <Input type="datetime-local" value={interviewAt} onChange={(e) => setInterviewAt(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Where (optional)
                <Input placeholder="Address, or leave blank" value={place} onChange={(e) => setPlace(e.target.value)} />
              </label>
              <Button type="button" className="sm:col-span-2" disabled={busy || !interviewAt} onClick={() => preview("interview")}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Invite to interview
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {next
              .filter((s) => s !== "interview" && EMAIL_FOR[s])
              .map((s) => (
                <Button key={`email-${s}`} type="button" variant={s === "not_a_fit" ? "outline" : "secondary"} disabled={busy} onClick={() => preview(EMAIL_FOR[s]!.kind)}>
                  {EMAIL_FOR[s]!.label}
                </Button>
              ))}
            {next
              .filter((s) => QUIET_LABEL[s])
              .map((s) => (
                <Button key={`quiet-${s}`} type="button" variant="ghost" disabled={busy} onClick={() => quiet(s)}>
                  {QUIET_LABEL[s]}
                </Button>
              ))}
          </div>
        </div>
      )}

      {draft && (
        <div className="space-y-2 border-t border-border pt-4">
          <h2 className="text-base font-semibold">This email goes to {draft.to}</h2>
          <p className="text-xs text-muted-foreground">Change anything you like. Nothing is sent until you press Send.</p>
          <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" />
          <Textarea rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Email" />
          <div className="flex gap-2">
            <Button type="button" className="flex-1" disabled={busy} onClick={send}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send email
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {message && <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-destructive"}`}>{message.text}</p>}
      {stage === "hired" && <p className="text-sm font-medium text-emerald-700">Hired. Add them on Team when they start.</p>}
    </section>
  );
}
