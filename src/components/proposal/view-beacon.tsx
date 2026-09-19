"use client";

import { useEffect, useRef } from "react";

import { recordProposalView } from "@/lib/actions/public-proposal-actions";

/**
 * Tells the office the client opened it, and does nothing else.
 *
 * Fires from the browser rather than during the server render on purpose. A
 * render happens for a prefetch, a bot and a warm cache; a mounted effect
 * happens when somebody is actually looking at the page. It also means the
 * proposal's own rendering is untouched, which matters because these are
 * already out with clients.
 *
 * Renders nothing, blocks nothing, and swallows everything.
 */
export function ViewBeacon({ token }: { token: string }) {
  const sent = useRef(false);

  useEffect(() => {
    // Once per mount. React runs effects twice in development, and a client
    // should not be counted twice for opening a page once.
    if (sent.current) return;
    sent.current = true;
    void recordProposalView({ token }).catch(() => {});
  }, [token]);

  return null;
}
