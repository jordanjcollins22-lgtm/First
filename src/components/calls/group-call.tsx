"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCallToken } from "@/lib/actions/call-token-actions";
import { DrawOverlay } from "@/components/calls/draw-overlay";

interface Connection {
  token: string;
  url: string;
}

/**
 * An internal-only call for one group: video, screen share (LiveKit's own
 * control bar handles both), and a shared drawing layer on top.
 *
 * The token is minted server-side after checking group membership, so
 * knowing the room name isn't enough to get in.
 */
export function GroupCall({ channelId, channelName }: { channelId: string; channelName: string }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getCallToken(channelId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        setConnecting(false);
        return;
      }
      setConnection({ token: result.token, url: result.url });
      setConnecting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  if (connecting) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Connecting to {channelName}...</p>
      </div>
    );
  }

  if (error || !connection) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <Video className="h-8 w-8 text-muted-foreground" />
        <p className="font-semibold">Couldn&apos;t join the call</p>
        <p className="text-sm text-muted-foreground">{error ?? "Something went wrong."}</p>
        <Button type="button" variant="outline" onClick={() => router.push(`/conversations/${channelId}`)}>
          Back to the group
        </Button>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={connection.token}
      serverUrl={connection.url}
      connect
      video
      audio
      onDisconnected={() => router.push(`/conversations/${channelId}`)}
      data-lk-theme="default"
      className="relative h-[75vh] overflow-hidden rounded-2xl border border-border"
    >
      <VideoConference />
      <DrawOverlay />
    </LiveKitRoom>
  );
}
