"use client";

import { useCallback, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { AFFILIATE_TUTORIAL, AFFILIATE_TUTORIAL_KEY } from "@/lib/affiliate-tutorial";
import { GameTutorial } from "@/components/tutorial/game-tutorial";

const LOCAL_KEY = `tutorial:${AFFILIATE_TUTORIAL_KEY}`;

function seenHere(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * The affiliate tutorial on Posts to Answer. Opens by itself for anybody
 * who has never finished or skipped it, remembered on their sign-in so a
 * new phone does not show it again; this browser also remembers, in case
 * saving to the sign-in fails.
 */
export function AffiliateTutorial({ seen }: { seen: boolean }) {
  const [autoStart] = useState(() => !seen && typeof window !== "undefined" && !seenHere());

  const done = useCallback(() => {
    try {
      window.localStorage.setItem(LOCAL_KEY, new Date().toISOString());
    } catch {
      // Private browsing: the sign-in still remembers.
    }
    if (seen) return;
    void createClient()
      .auth.updateUser({ data: { [AFFILIATE_TUTORIAL_KEY]: new Date().toISOString() } })
      .catch(() => undefined);
  }, [seen]);

  return <GameTutorial steps={AFFILIATE_TUTORIAL} autoStart={autoStart} onDone={done} />;
}
