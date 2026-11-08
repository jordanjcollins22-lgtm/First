"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readVideo, type NotesResult } from "@/lib/actions/video-notes-actions";
import { GOALS, youtubeId } from "@/lib/video-notes";

/**
 * Paste a YouTube link, say what you know and what you want from it, and get
 * what you learned: the key fundamentals, your questions answered, and how to
 * use it. K-W-L, with the reading done for you.
 */
export function VideoNotes() {
  const [link, setLink] = useState("");
  const [know, setKnow] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [own, setOwn] = useState("");
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(true);
  const [result, setResult] = useState<NotesResult | null>(null);
  const [pending, start] = useTransition();
  const valid = Boolean(youtubeId(link)) || pasted.trim().length > 200;
  const want = [...goals, ...own.split("\n").map((s) => s.trim()).filter(Boolean)];

  const go = () =>
    start(async () => {
      setResult(null);
      const r = await readVideo({ link, know, want, pasted: showPaste ? pasted : "" });
      setResult(r);
      if (!r.ok && r.needsPaste) setShowPaste(true);
    });

  return (
    <div className="space-y-5">
      <section id="kwl" className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">1 · The video</p>
          <Input className="mt-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link" inputMode="url" />
          {link && !youtubeId(link) && <p className="mt-1 text-sm text-destructive">That isn&apos;t a YouTube video link.</p>}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2 · K: what you already know (optional)</p>
          <Textarea className="mt-1" rows={2} value={know} onChange={(e) => setKnow(e.target.value)} placeholder="So it skips what you know. e.g. I already run Google ads but don't track them." />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">3 · W: what you want to get out of it</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {GOALS.map((g) => {
              const on = goals.includes(g);
              return (
                <Button key={g} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => setGoals(on ? goals.filter((x) => x !== g) : [...goals, g])}>
                  {g}
                </Button>
              );
            })}
          </div>
          <Textarea className="mt-2" rows={2} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Or your own questions, one per line. e.g. What budget does he start with?" />
        </div>
        {showPaste && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">4 · The transcript</p>
            <p className="text-sm text-muted-foreground">YouTube blocks apps from pulling it, so copy it in: on YouTube, open the description, tap Show transcript, select it all, copy, paste here.</p>
            <Textarea className="mt-1" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the transcript here" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={go} disabled={!valid || pending}>
            {pending ? "Reading the video…" : "Read it for me"}
          </Button>
          {!showPaste && (
            <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setShowPaste(true)}>
              Paste the transcript instead
            </button>
          )}
        </div>
        {pending && <p className="text-sm text-muted-foreground">Reading the whole video. A long one takes up to a minute.</p>}
        {result && !result.ok && <p className="text-sm font-medium text-destructive">{result.error}</p>}
      </section>

      {result?.ok && (
        <section id="learned" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">L: what you learned</p>
            <h2 className="text-lg font-bold">{result.title}</h2>
            <p className="text-sm text-muted-foreground">
              {[result.author, result.minutes ? `${result.minutes} min` : "", result.fromPaste ? "from your pasted transcript" : ""].filter(Boolean).join(" · ")}
            </p>
            {result.notes.gist && <p className="mt-1">{result.notes.gist}</p>}
          </div>
          <div>
            <h3 className="font-bold">Key fundamentals</h3>
            <ol className="mt-1 list-decimal space-y-2 pl-5">
              {result.notes.fundamentals.map((f, i) => (
                <li key={i}>
                  <span className="font-semibold">{f.point}.</span> {f.detail}
                </li>
              ))}
            </ol>
          </div>
          {result.notes.answers.length > 0 && (
            <div>
              <h3 className="font-bold">What you wanted to know</h3>
              <dl className="mt-1 space-y-2">
                {result.notes.answers.map((a, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-2">
                    <dt className="text-sm font-semibold">{a.question}</dt>
                    <dd className="text-sm">{a.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {result.notes.learned && (
            <div>
              <h3 className="font-bold">In short</h3>
              <p className="text-sm">{result.notes.learned}</p>
            </div>
          )}
          {result.notes.use.length > 0 && (
            <div>
              <h3 className="font-bold">Put it to use</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {result.notes.use.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
          {result.notes.watchIt && <p className="text-sm text-muted-foreground">Worth watching? {result.notes.watchIt}</p>}
        </section>
      )}
    </div>
  );
}
