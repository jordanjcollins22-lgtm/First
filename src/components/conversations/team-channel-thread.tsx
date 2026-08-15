"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Mic, Square, Video, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  postTeamMessage,
  setTeamChannelMember,
  transcribeVoiceMemo,
  type MessageAttachment as MessageAttachmentInput,
} from "@/lib/actions/team-channel-actions";
import { MessageAttachment } from "@/components/conversations/message-attachment";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AttachmentKind, TeamChannelWithMembers, TeamMessage } from "@/types/domain";

interface TeamMember {
  id: string;
  name: string;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TeamChannelThread({
  channel,
  messages: initialMessages,
  currentProfileId,
  teamMembers,
}: {
  channel: TeamChannelWithMembers;
  messages: TeamMessage[];
  currentProfileId: string;
  teamMembers: TeamMember[];
}) {
  // Messages that landed since this page was rendered — from Realtime, or
  // from this person's own send. Kept separate from the server's list and
  // merged at render time rather than copied into state, so a fresh server
  // render can never replace what has already arrived.
  const [liveMessages, setLiveMessages] = useState<TeamMessage[]>([]);

  const messages = useMemo(() => {
    const fromServer = new Set(initialMessages.map((m) => m.id));
    const extra = liveMessages.filter((m) => !fromServer.has(m.id));
    if (extra.length === 0) return initialMessages;
    return [...initialMessages, ...extra].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [initialMessages, liveMessages]);

  const addLiveMessage = useCallback((incoming: TeamMessage) => {
    setLiveMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
  }, []);

  // Read by the catch-up poll below, which must not re-run every time a
  // message lands or it would restart its own timer.
  const latestAtRef = useRef<string>("");
  useEffect(() => {
    latestAtRef.current = messages.length > 0 ? messages[messages.length - 1].created_at : "";
  }, [messages]);
  const [body, setBody] = useState("");
  const [pendingFile, setPendingFile] = useState<{ file: File; kind: AttachmentKind } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [memberIds, setMemberIds] = useState<string[]>(channel.memberIds);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isMember = memberIds.includes(currentProfileId);

  // Live updates instead of waiting for a refresh.
  //
  // Realtime runs the members-only RLS policy against whatever token the
  // socket is carrying when the channel joins. The session is read from
  // cookies asynchronously, so subscribing straight away can join as anon —
  // the policy then matches nothing and no events ever arrive. Hence
  // resolving the session and calling setAuth before subscribing.
  useEffect(() => {
    const supabase = createClient();
    let channelRef: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      channelRef = supabase
        .channel(`team_messages:${channel.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "team_messages",
            filter: `channel_id=eq.${channel.id}`,
          },
          (payload) => {
            addLiveMessage(payload.new as TeamMessage);
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channelRef) supabase.removeChannel(channelRef);
    };
  }, [channel.id, addLiveMessage]);

  // A backstop for the socket: sockets drop on sleep, network changes, and
  // flaky mobile connections, and a dropped one fails silently. This asks for
  // anything newer than the last message seen — a narrow indexed query — so a
  // thread left open still catches up within a few seconds. Realtime is what
  // makes it feel instant; this is what makes it correct.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function catchUp() {
      if (cancelled || !latestAtRef.current) return;
      const { data } = await supabase
        .from("team_messages")
        .select("*")
        .eq("channel_id", channel.id)
        .gt("created_at", latestAtRef.current)
        .order("created_at");
      if (cancelled || !data) return;
      for (const row of data) addLiveMessage(row as unknown as TeamMessage);
    }

    const timer = setInterval(catchUp, 10_000);
    window.addEventListener("focus", catchUp);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", catchUp);
    };
  }, [channel.id, addLiveMessage]);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** Uploads to the group's folder — storage checks membership against that
   * first path segment, so the path is what enforces access. */
  async function uploadAttachment(file: File, kind: AttachmentKind): Promise<MessageAttachmentInput | null> {
    const supabase = createClient();
    const extension = file.name.split(".").pop() || (kind === "audio" ? "webm" : "bin");
    const path = `${channel.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("message-attachments").upload(path, file);
    if (uploadError) {
      setError("Couldn't upload that — check your connection and try again.");
      return null;
    }
    return { path, kind, name: file.name };
  }

  function handleSend() {
    if (!body.trim() && !pendingFile) return;
    setError(null);
    const outgoing = pendingFile;

    startTransition(async () => {
      let attachment: MessageAttachmentInput | undefined;
      if (outgoing) {
        setUploading(true);
        const uploaded = await uploadAttachment(outgoing.file, outgoing.kind);
        setUploading(false);
        if (!uploaded) return;
        attachment = uploaded;
      }

      const result = await postTeamMessage(channel.id, body, attachment);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Don't wait on Realtime to echo it back.
      addLiveMessage(result.message);
      setBody("");
      setPendingFile(null);

      // Transcribe after the memo is already in the thread, then swap the
      // message for the transcribed copy. A failure leaves a playable memo.
      if (attachment?.kind === "audio") {
        const transcribed = await transcribeVoiceMemo(result.message.id);
        if (transcribed.ok) {
          setLiveMessages((prev) =>
            prev.map((m) => (m.id === result.message.id ? { ...m, transcript: transcribed.transcript } : m))
          );
        }
      }
    });
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `voice-memo-${Date.now()}.webm`, { type: blob.type });
        setPendingFile({ file, kind: "audio" });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Couldn't reach your microphone — check the browser's permission.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function toggleMember(profileId: string) {
    const nextIsMember = !memberIds.includes(profileId);
    setMemberIds((prev) => (nextIsMember ? [...prev, profileId] : prev.filter((id) => id !== profileId)));
    setError(null);
    startTransition(async () => {
      const result = await setTeamChannelMember(channel.id, profileId, nextIsMember);
      if (!result.ok) {
        setMemberIds((prev) => (nextIsMember ? prev.filter((id) => id !== profileId) : [...prev, profileId]));
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {memberIds.length} member{memberIds.length === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            {isMember && (
              <Button type="button" size="sm" asChild>
                <Link href={`/conversations/${channel.id}/call`}>
                  <Video className="h-3.5 w-3.5" />
                  Start call
                </Link>
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setShowMembers((v) => !v)}>
              {showMembers ? "Done" : "Manage members"}
            </Button>
          </div>
        </div>
        {showMembers ? (
          <div className="flex flex-wrap gap-2">
            {teamMembers.map((member) => {
              const selected = memberIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member.id)}
                  disabled={isPending}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card/60 hover:bg-accent"
                  )}
                >
                  {member.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {memberIds
              .map((id) => teamMembers.find((m) => m.id === id)?.name)
              .filter(Boolean)
              .join(", ") || "Nobody yet."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <div ref={scrollRef} className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isMember ? "No messages yet — say something." : "Add yourself as a member to see and post messages."}
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex max-w-[85%] flex-col gap-0.5 rounded-lg p-2.5 text-sm",
                  m.author_profile_id === currentProfileId ? "self-end bg-primary/10" : "self-start bg-muted/40"
                )}
              >
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                {m.attachment_path && <MessageAttachment message={m} />}
                <p className="text-[10px] text-muted-foreground">
                  {m.author_name} · {formatTimestamp(m.created_at)}
                </p>
              </div>
            ))
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-col gap-2">
          {pendingFile && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-2">
              <p className="min-w-0 truncate text-xs">
                {pendingFile.kind === "audio" ? "Voice memo ready to send" : pendingFile.file.name}
              </p>
              <button
                type="button"
                onClick={() => setPendingFile(null)}
                disabled={isPending}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove attachment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={isMember ? "Message the group..." : "Add yourself as a member to post"}
            rows={2}
            disabled={!isMember}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setPendingFile({ file, kind: file.type.startsWith("video/") ? "video" : "image" });
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!isMember || isPending || recording}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
                Photo or video
              </Button>
              {recording ? (
                <Button type="button" size="sm" variant="destructive" onClick={stopRecording}>
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!isMember || isPending}
                  onClick={startRecording}
                >
                  <Mic className="h-4 w-4" />
                  Voice memo
                </Button>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              disabled={isPending || !isMember || recording || (!body.trim() && !pendingFile)}
              onClick={handleSend}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Send"
              )}
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            {recording
              ? "Recording — press Stop when you're done."
              : "Team only — the client never sees this. Voice memos are transcribed automatically."}
          </p>
        </div>
      </div>
    </div>
  );
}
