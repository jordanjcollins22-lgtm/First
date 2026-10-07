"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Records the applicant's video right in the page, at a bitrate that keeps a
 * minute around 12 MB. The phone's own camera app records at full quality,
 * which runs 80 MB or more for 40 seconds, past what storage takes in one go.
 */

/** The formats to try, best first: Safari records MP4, Chrome on Android WebM. */
const TYPES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const VIDEO_BITS = 1_400_000;
const AUDIO_BITS = 64_000;
/** Stops by itself here, so a forgotten recording can't grow past the limit. */
const MAX_SECONDS = 180;

/** Whether this browser can record in the page at all; when not, the camera app is used. */
export function canRecordHere(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function pickType(): string | undefined {
  return TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t));
}

export function VideoRecorder({
  onDone,
  onCancel,
  onFail,
}: {
  onDone: (file: File) => void;
  onCancel: () => void;
  onFail: () => void;
}) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          void previewRef.current.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch(() => {
        // Camera refused or missing: the camera app is the way instead.
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
      // Leaving the page mid-recording throws it away rather than sending it.
      discardRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onFail]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) recorderRef.current?.stop();
  }, [recording, seconds]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS,
        audioBitsPerSecond: AUDIO_BITS,
      });
    } catch {
      return onFail();
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      setRecording(false);
      const type = (recorder.mimeType || mimeType || "video/webm").split(
        ";",
      )[0];
      const blob = new Blob(chunks, { type });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone(
        new File([blob], `video.${type === "video/mp4" ? "mp4" : "webm"}`, {
          type,
        }),
      );
    };
    recorderRef.current = recorder;
    setSeconds(0);
    recorder.start(1000);
    setRecording(true);
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="grid gap-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={previewRef}
          muted
          playsInline
          className="aspect-[3/4] w-full -scale-x-100 object-cover"
        />
        {recording && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
            <Circle className="h-2.5 w-2.5 fill-red-500 text-red-500" /> {clock}
          </span>
        )}
        {!ready && (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/80">
            Starting your camera…
          </p>
        )}
      </div>
      {recording ? (
        <Button
          type="button"
          className="h-12 text-base font-semibold"
          onClick={() => recorderRef.current?.stop()}
        >
          <Square className="mr-2 h-4 w-4 fill-current" /> Stop and send
        </Button>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button
            type="button"
            className="h-12 text-base font-semibold"
            disabled={!ready}
            onClick={startRecording}
          >
            <Circle className="mr-2 h-4 w-4 fill-red-500 text-red-500" /> Start
            recording
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
