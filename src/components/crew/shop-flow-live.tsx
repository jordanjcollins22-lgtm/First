"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Every phone follows the tablet.
 *
 * Any change to the day's shop screen or its ticks refreshes this page, so a
 * tool ticked in the yard ticks on the phone in the truck. A slow poll backs
 * the socket up for the phone that lost it.
 */
export function ShopFlowLive({ shopDayId }: { shopDayId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const bump = () => router.refresh();
    const channel = supabase
      .channel(`shop_flow_${shopDayId ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crew_shop_days" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "crew_shop_checks" }, bump)
      .subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router, shopDayId]);
  return null;
}
