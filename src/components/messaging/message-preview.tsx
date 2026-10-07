"use client";

import { useState } from "react";
import { Expand, X } from "lucide-react";

import { textToHtml } from "@/lib/email/plain";

/**
 * An email as the client's inbox shows it: who it is from, the subject,
 * and the body rendered the way the sender renders it. Tap to read it full
 * size.
 */
export function EmailPreview({
  fromName,
  fromEmail,
  toName,
  subject,
  text,
}: {
  fromName: string;
  fromEmail: string | null;
  toName: string;
  subject: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  const email = (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-left text-[#1a1a1a] shadow-sm dark:bg-white">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
        <p>
          <span className="font-semibold text-neutral-800">{fromName}</span>
          {fromEmail && <span> &lt;{fromEmail}&gt;</span>}
        </p>
        <p>To: {toName}</p>
      </div>
      <p className="px-3 pt-3 text-base font-semibold leading-snug">{subject}</p>
      {/* textToHtml escapes everything; it is the same function the sender uses. */}
      <div className="px-3 pb-3 pt-2 [&_a]:break-all [&_a]:text-blue-700 [&_a]:underline" dangerouslySetInnerHTML={{ __html: textToHtml(text) }} />
    </div>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative block w-full text-left" aria-label={`Open the email: ${subject}`}>
        {email}
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 opacity-80 shadow group-hover:opacity-100">
          <Expand className="h-3 w-3" /> Full size
        </span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-label={subject} onClick={() => setOpen(false)}>
          <div className="my-6 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-sm font-medium text-neutral-800">
                <X className="h-4 w-4" /> Close
              </button>
            </div>
            {email}
          </div>
        </div>
      )}
    </>
  );
}

/** A text as it lands on the client's phone. */
export function TextPreview({ from, body }: { from: string; body: string }) {
  return (
    <div className="mx-auto w-full max-w-xs overflow-hidden rounded-[1.75rem] border-4 border-neutral-800 bg-white text-left shadow-sm">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-center">
        <p className="text-sm font-semibold text-neutral-800">{from}</p>
        <p className="text-[11px] text-neutral-500">Text message</p>
      </div>
      <div className="min-h-48 px-3 py-4">
        <p className="max-w-[85%] whitespace-pre-line rounded-2xl [overflow-wrap:anywhere] rounded-bl-sm bg-neutral-200 px-3 py-2 text-sm text-neutral-900">{body}</p>
        <p className="mt-1 text-[11px] text-neutral-500">{body.length} characters</p>
      </div>
    </div>
  );
}
