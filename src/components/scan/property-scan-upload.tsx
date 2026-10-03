"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Film, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { scanFolder, scanFramePath, scanFrameSize, scanFrameTimes, type ScanManifest } from "@/lib/scan-frames";

type Phase = "idle" | "working" | "done" | "error";

/**
 * A walk-around video of the property, turned into stills for a 3D model.
 * The video never uploads whole: the phone takes about two stills a second
 * from it, shrinks each, and sends those, which is what the model is built
 * from and a fraction of the size. Nothing is processed here yet; this is
 * the demo's upload.
 */
export function PropertyScanUpload({ jobId, uploadedBy, scans }: { jobId: string; uploadedBy: string | null; scans: { id: string; frames: number; uploadedAt: string; firstFrameUrl: string | null }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Let go of the last video's preview when the page closes.
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  async function start() {
    const video = videoRef.current;
    if (!file || !video) return;
    setPhase("working");
    setMessage(null);
    setDone(0);
    const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
    setScanId(id);
    try {
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth === 0) {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error("unreadable"));
        });
      }
      const times = scanFrameTimes(video.duration);
      if (times.length === 0) throw new Error("This video has no length to take stills from.");
      setTotal(times.length);
      const size = scanFrameSize(video.videoWidth, video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't draw the video.");
      const storage = createClient().storage.from("canvas-images");
      const inFlight = new Set<Promise<void>>();
      let sent = 0;
      for (let i = 0; i < times.length; i++) {
        await seek(video, times[i]);
        ctx.drawImage(video, 0, 0, size.width, size.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
        if (!blob) throw new Error("Couldn't take a still from the video.");
        const path = scanFramePath(jobId, id, i);
        const upload = storage
          .upload(path, blob, { contentType: "image/jpeg", upsert: true })
          .then(({ error }) => {
            if (error) throw new Error(`Couldn't upload a still: ${error.message}`);
            sent++;
            setDone(sent);
          });
        const tracked: Promise<void> = upload.finally(() => inFlight.delete(tracked));
        inFlight.add(tracked);
        if (inFlight.size >= 4) await Promise.race(inFlight);
      }
      await Promise.all(inFlight);
      const manifest: ScanManifest = {
        scanId: id,
        jobId,
        frames: times.length,
        durationSeconds: Math.round(video.duration * 10) / 10,
        width: size.width,
        height: size.height,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy,
      };
      const { error } = await storage.upload(`${scanFolder(jobId, id)}/manifest.json`, new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }), {
        contentType: "application/json",
        upsert: true,
      });
      if (error) throw new Error(`Couldn't save the scan's details: ${error.message}`);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setMessage(
        err instanceof Error && err.message === "unreadable"
          ? "This browser can't play that video. iPhone videos (HEVC) play in Safari; on a computer, try Safari or Edge, or set the camera to Most Compatible."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Try again."
      );
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Upload a walk-around video</h2>
          <p className="text-sm text-muted-foreground">
            Walk the whole yard slowly, about a step a second, with the phone at chest height pointed at the beds. Go all the way around, then a second lap a little closer. Two or three
            minutes is plenty.
          </p>
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm font-medium hover:bg-muted/40">
          <Film className="h-5 w-5 text-primary" />
          {file ? file.name : "Choose or record a video"}
          <input
            type="file"
            accept="video/*"
            className="hidden"
            disabled={phase === "working"}
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              setUrl(picked ? URL.createObjectURL(picked) : null);
              setPhase("idle");
              setMessage(null);
            }}
          />
        </label>
        {url && (
          // The stills are taken from this player, so it has to be able to play the file.
          <video ref={videoRef} src={url} muted playsInline preload="auto" controls className="max-h-72 w-full rounded-lg bg-black" />
        )}
        {file && phase !== "done" && (
          <Button type="button" className="h-12 text-base font-semibold" disabled={phase === "working"} onClick={start}>
            {phase === "working" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Upload className="mr-2 h-5 w-5" />}
            {phase === "working" ? `Taking stills and uploading… ${done} of ${total}` : "Upload for a 3D scan"}
          </Button>
        )}
        {phase === "working" && (
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`${pct}% uploaded`}>
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {phase === "done" && (
          <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Uploaded {total} stills as scan <span className="font-mono">{scanId}</span>. Processing into a 3D model isn&apos;t automatic yet in this demo: tell Claude the scan is in and it will
              build the model and the top-down plan from it.
            </span>
          </p>
        )}
        {message && <p className="text-sm text-destructive">{message}</p>}
      </section>

      {scans.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Scans of this property</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scans.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2">
                {s.firstFrameUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.firstFrameUrl} alt="" className="h-14 w-20 rounded-md bg-muted object-cover" />
                ) : (
                  <span className="h-14 w-20 rounded-md bg-muted" />
                )}
                <span className="text-sm">
                  <span className="block font-mono text-xs">{s.id}</span>
                  {s.frames} stills · {new Date(s.uploadedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Move the player to a moment and wait until that frame is showing. */
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      reject(new Error("unreadable"));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = time;
  });
}
