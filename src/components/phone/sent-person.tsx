"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyNow, writeClipboard } from "@/lib/clipboard";

/**
 * One person in People you sent it to. Tap it to see the message that went
 * with their link and copy it again, in case it never got copied or sent.
 */
export function SentPerson({ a, b, message }: { a: string; b: string; message: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    const ok = copyNow(message) || (await writeClipboard(message));
    if (!ok) return setError("Couldn't copy. Press and hold the message to copy it.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <>
      <button type="button" className="vx-row vx-tap vx-sent" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{a}</span>
        <b>{b}</b>
      </button>
      {open && (
        <div className="vx-sent-open">
          <textarea readOnly rows={9} value={message} aria-label={`Message for ${a}`} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="vx-cta" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy message again"}
          </button>
          {error && <p className="vx-sm">{error}</p>}
        </div>
      )}
    </>
  );
}
