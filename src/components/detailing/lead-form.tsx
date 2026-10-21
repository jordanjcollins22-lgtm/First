"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { createDetailingLead, type LeadFormState } from "@/lib/actions/detailing-lead-actions";

const fieldClass =
  "w-full rounded-md border border-white/15 bg-white/5 px-4 py-3.5 text-base text-white placeholder:text-white/40 focus:border-[#d4a843] focus:outline-none focus:ring-1 focus:ring-[#d4a843]";

export function LeadForm() {
  const [state, formAction, pending] = useActionState<LeadFormState, FormData>(createDetailingLead, {});
  const v = state.values;

  return (
    <form action={formAction} className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Full name
        <input name="name" required defaultValue={v?.name} autoComplete="name" placeholder="Jane Smith" className={fieldClass} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Phone number
        <input name="phone" type="tel" required defaultValue={v?.phone} autoComplete="tel" placeholder="(443) 555-0123" className={fieldClass} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Email
        <input name="email" type="email" required defaultValue={v?.email} autoComplete="email" placeholder="you@email.com" className={fieldClass} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Where will the car be?
        <input
          name="address"
          required
          defaultValue={v?.address}
          autoComplete="street-address"
          placeholder="Street address, city, zip"
          className={fieldClass}
        />
        <span className="text-xs font-normal text-white/45">Home, work — anywhere we can park next to it.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-gold mt-2 inline-flex h-14 items-center justify-center gap-2 rounded-md px-6 text-base font-bold uppercase tracking-wider text-black transition hover:brightness-110 disabled:opacity-70"
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : <>See my plan <ArrowRight className="size-5" /></>}
      </button>
      <p className="text-center text-xs text-white/45">No payment now. We&apos;ll only use this to schedule your detail.</p>
    </form>
  );
}
