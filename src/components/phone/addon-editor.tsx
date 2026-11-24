"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveProposalAddon } from "@/lib/actions/proposal-actions";
import { CHRISTMAS_LIGHTS_KEY, CHRISTMAS_LIGHTS_NAME, addonLines, type ProposalAddon } from "@/lib/proposal-addons";
import { money } from "@/components/phone/parts";

/**
 * The account manager's Christmas lights add-on for one proposal: the price,
 * what gets decorated, whose lights and whether takedown is in it. The
 * client sees it as a box to tick when they accept; it costs them nothing
 * unless they tick it.
 */
export function AddonEditor({ jobId, addons }: { jobId: string; addons: ProposalAddon[] }) {
  const router = useRouter();
  const current = addons.find((a) => a.key === CHRISTMAS_LIGHTS_KEY) ?? null;
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(current ? String(current.priceCents / 100) : "");
  const [decorate, setDecorate] = useState(current?.decorate ?? "");
  const [lights, setLights] = useState<string>(current?.lights ?? "");
  const [takedown, setTakedown] = useState<string>(current?.takedown ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, start] = useTransition();

  const save = (remove: boolean) =>
    start(async () => {
      const r = await saveProposalAddon(
        jobId,
        CHRISTMAS_LIGHTS_KEY,
        remove ? null : { name: CHRISTMAS_LIGHTS_NAME, price, decorate, lights, takedown, note }
      );
      if (!r.ok) {
        setMsg({ text: r.error, bad: true });
        return;
      }
      setMsg({ text: remove ? "Taken off the proposal." : "Saved. The client can tick it when they accept.", bad: false });
      if (remove) {
        setPrice("");
        setDecorate("");
        setLights("");
        setTakedown("");
        setNote("");
      }
      setOpen(false);
      router.refresh();
    });

  if (!open) {
    return (
      <>
        {current && (
          <div className="vx-q">
            <b>
              {current.name} add-on · {money(current.priceCents / 100)}
            </b>
            {addonLines(current).map((l) => (
              <div key={l} className="vx-sm">
                {l}
              </div>
            ))}
          </div>
        )}
        <button type="button" className="vx-cta vx-alt" onClick={() => setOpen(true)}>
          {current ? "Change Christmas lights option" : "Offer Christmas lights"}
        </button>
        {msg && <div className={`vx-note ${msg.bad ? "bad" : "ok"}`}>{msg.text}</div>}
      </>
    );
  }

  return (
    <div className="vx-q" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>Christmas lights option</b>
      <div className="vx-sm">The client sees this as a box to tick when they accept. They only pay for it if they tick it.</div>
      <label className="vx-sm">
        Price for the lights ($)
        <input className="vx-field" inputMode="decimal" placeholder="e.g. 450" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="vx-sm">
        What we decorate
        <input
          className="vx-field"
          placeholder="e.g. Roofline across the front, bushes by the door"
          value={decorate}
          onChange={(e) => setDecorate(e.target.value)}
        />
      </label>
      <label className="vx-sm">
        Whose lights
        <select className="vx-field" value={lights} onChange={(e) => setLights(e.target.value)}>
          <option value="">Don&apos;t say</option>
          <option value="ours">We supply the lights</option>
          <option value="theirs">We hang the client&apos;s lights</option>
        </select>
      </label>
      <label className="vx-sm">
        Takedown after the holidays
        <select className="vx-field" value={takedown} onChange={(e) => setTakedown(e.target.value)}>
          <option value="">Don&apos;t say</option>
          <option value="included">Included in the price</option>
          <option value="not_included">Not included</option>
        </select>
      </label>
      <label className="vx-sm">
        Anything else the client should know (optional)
        <input className="vx-field" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="vx-2b">
        <button type="button" className="vx-cta" disabled={busy} onClick={() => save(false)}>
          Save
        </button>
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => (current ? save(true) : setOpen(false))}>
          {current ? "Take it off" : "Cancel"}
        </button>
      </div>
      {msg && <div className={`vx-note ${msg.bad ? "bad" : "ok"}`}>{msg.text}</div>}
    </div>
  );
}
