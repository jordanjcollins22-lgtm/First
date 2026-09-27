"use client";

import { useState, useTransition } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveShopAccess } from "@/lib/actions/shop-access-actions";

/**
 * The shop, for the crew's morning: when they are due, and the codes that
 * get them in. Shown to our crew when they arrive and to a subcontractor
 * who picks up our tools. Each kit's own code is on the kit below.
 */
export function ShopAccessCard({ arriveBy, accessCodes }: { arriveBy: string | null; accessCodes: string | null }) {
  const [time, setTime] = useState((arriveBy ?? "07:00").slice(0, 5));
  const [codes, setCodes] = useState(accessCodes ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await saveShopAccess({ arriveBy: time, accessCodes: codes });
      if (!result.ok) return setError(result.message);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">The shop</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Crew there by</span>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Codes to get in</span>
          <Input value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="e.g. Gate 1234, side door 5678" className="h-10" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Our crew sees these when they get to the shop, and so does a subcontractor who picks up our tools. Each kit&apos;s own code is set on
        the kit.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : saved ? <Check className="mr-1 h-4 w-4" /> : null}
          {saved ? "Saved" : "Save"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
