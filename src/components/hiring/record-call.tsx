"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Circle, Loader2, Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { startCallRecording } from "@/lib/actions/recording-actions";
import { RECORDING_BUCKET, RECORDING_CONSENT_PROMPT, type RecordingOwner } from "@/lib/hiring/recordings";

/**
 * Tap to record a hiring call, audio only, right in the page. Start stays
 * off until the person recording ticks that everyone on the call said OK.
 * When it stops, it saves itself and hands back where it went.
 */

const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
const AUDIO_BITS = 32_000;
/** Stops by itself here, so a forgotten recording can't grow past what storage takes. */
const MAX_SECONDS = 90 * 60;

export type Recorded = { path: string; seconds: number };

export function RecordCall({ owner, id, label = "Record the call", onSaved }: { owner: RecordingOwner; id: string; label?: string; onSaved: (r: Recorded) => void }) {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const secondsRef = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => (secondsRef.current = s + 1)), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) recorderRef.current?.stop();
  }, [recording, seconds]);

  // Leaving the page stops the microphone.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function begin() {
    setError(null);
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return setError("This browser can't record here. Open this page in Chrome or Safari.");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError("We couldn't use the microphone. Allow it for this page, then try again.");
    }
    streamRef.current = stream;
    const mimeType = TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return setError("This browser can't record here. Open this page in Chrome or Safari.");
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      setRecording(false);
      stream.getTracks().forEach((t) => t.stop());
      const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
      save(new Blob(chunks, { type }), type, secondsRef.current);
    };
    recorderRef.current = recorder;
    secondsRef.current = 0;
    setSeconds(0);
    recorder.start(1000);
    setRecording(true);
  }

  function save(blob: Blob, type: string, length: number) {
    start(async () => {
      const slot = await startCallRecording({ owner, id, type, size: blob.size });
      if (!slot.ok) return setError(slot.message);
      const sent = await createClient().storage.from(RECORDING_BUCKET).uploadToSignedUrl(slot.path, slot.uploadToken, blob, { contentType: type });
      if (sent.error) return setError("The recording didn't save. Check the connection and record again.");
      setOpen(false);
      setAgreed(false);
      onSaved({ path: slot.path, seconds: length });
    });
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Mic className="mr-1.5 h-4 w-4" /> {label}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      {!recording && !saving && (
        <>
          <p className="text-xs text-muted-foreground">{RECORDING_CONSENT_PROMPT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I told them, and everyone on the call said OK
          </label>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <>
            <span className="flex items-center gap-1 text-sm font-semibold">
              <Circle className="h-2.5 w-2.5 fill-red-500 text-red-500" /> {clock}
            </span>
            <Button type="button" size="sm" onClick={() => recorderRef.current?.stop()}>
              <Square className="mr-1.5 h-3.5 w-3.5 fill-current" /> Stop and save
            </Button>
          </>
        ) : saving ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Saving. Keep this page open
          </span>
        ) : (
          <>
            <Button type="button" size="sm" disabled={!agreed} onClick={begin}>
              <Circle className="mr-1.5 h-3.5 w-3.5 fill-red-500 text-red-500" /> Start recording
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
