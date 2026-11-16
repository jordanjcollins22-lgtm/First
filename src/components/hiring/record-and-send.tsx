"use client";

import { useState, useTransition } from "react";
import { Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { finishApplicantVideo, finishSkillsVideo, startApplicantVideo } from "@/lib/actions/hiring-public-actions";
import { VideoRecorder, canRecordHere } from "@/components/hiring/video-recorder";

const CANT_RECORD =
  "This browser can't record here. Open this link in Chrome or Safari on your phone, allow the camera and microphone, and tap Record again.";
const NO_CAMERA = "We couldn't use your camera. Allow the camera and microphone for this page, then tap Record again.";
const TOO_BIG = "That recording is too long to send. Tap Record and keep it to a couple of minutes.";

/**
 * Tap to record, live, in the page, then it sends itself. There is no file
 * picker, no camera-roll upload and no link: what we get is recorded here.
 */
export function RecordAndSend({ token, purpose, label, onSent }: { token: string; purpose: "intro" | "skills"; label: string; onSent: () => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function recordNow() {
    setError(null);
    if (!canRecordHere()) return setError(CANT_RECORD);
    setRecording(true);
  }

  function send(file: File) {
    setRecording(false);
    const type = file.type.split(";")[0];
    start(async () => {
      const slot = await startApplicantVideo({ token, type, size: file.size, purpose });
      if (!slot.ok) return setError(slot.error === "too_big" ? TOO_BIG : slot.error);
      const sent = await createClient().storage.from("applicant-videos").uploadToSignedUrl(slot.path, slot.uploadToken, file, { contentType: type });
      if (sent.error) {
        return setError(/exceed|too large|413|maximum/i.test(sent.error.message) ? TOO_BIG : "It didn't send. Check your signal and tap Record to try again.");
      }
      const finished = purpose === "skills" ? await finishSkillsVideo({ token, path: slot.path }) : await finishApplicantVideo({ token, path: slot.path });
      if (!finished.ok) return setError(finished.error);
      onSent();
    });
  }

  return (
    <div className="grid gap-2">
      {recording ? (
        <VideoRecorder
          onDone={send}
          onCancel={() => setRecording(false)}
          onFail={() => {
            setRecording(false);
            setError(NO_CAMERA);
          }}
        />
      ) : (
        <Button type="button" className="h-12 text-base font-semibold" disabled={busy} onClick={recordNow}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Video className="mr-2 h-5 w-5" />}
          {busy ? "Sending. Keep this page open" : label}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
