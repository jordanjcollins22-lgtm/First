"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startNewEstimate } from "@/lib/actions/new-estimate-actions";

/**
 * "New estimate": who and where, then straight onto the estimate map to
 * price it. From a client's page their name, phone and email are filled in.
 */
export function NewEstimate({
  customerId,
  name: startName = "",
  phone: startPhone = "",
  email: startEmail = "",
  address: startAddress = "",
  label = "New estimate",
}: {
  customerId?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(startName);
  const [phone, setPhone] = useState(startPhone);
  const [email, setEmail] = useState(startEmail);
  const [address, setAddress] = useState(startAddress);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="vx-cta" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  const go = () =>
    start(async () => {
      setNote(null);
      try {
        const r = await startNewEstimate({ customerId, name, phone, email, address });
        if (r.ok) router.push(`/prep/${r.token}/map`);
        else setNote(r.error);
      } catch {
        setNote("That didn't go through. Try again.");
      }
    });

  return (
    <div className="vx-card">
      <div className="vx-who">{label}</div>
      <input className="vx-field" placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Client name" autoComplete="off" />
      <input className="vx-field" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" autoComplete="off" />
      <input className="vx-field" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" autoComplete="off" />
      <input className="vx-field" placeholder="Property address, town and zip" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Property address" autoComplete="off" />
      <div className="vx-2b">
        <button type="button" className="vx-cta" disabled={busy} onClick={go}>
          {busy ? "Opening the map…" : "Price it on the map"}
        </button>
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {note && <div className="vx-note bad">{note}</div>}
    </div>
  );
}
