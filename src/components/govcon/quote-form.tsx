"use client";

import { useActionState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { declineQuote, submitQuote, type QuoteFormState } from "@/lib/actions/quote-portal-actions";

function YesNo({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="yes" required={required} /> Yes
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="no" /> No
        </label>
      </div>
    </fieldset>
  );
}

export function QuoteForm({
  token,
  defaults,
  requiresSmallBusiness,
}: {
  token: string;
  defaults: { contactEmail: string | null; contactPhone: string | null };
  requiresSmallBusiness: boolean;
}) {
  const [state, formAction, pending] = useActionState<QuoteFormState, FormData>(submitQuote.bind(null, token), {});
  const [declining, startDecline] = useTransition();

  if (state.ok) {
    return (
      <div className="rounded-lg border border-primary/40 bg-accent p-4 text-sm">
        <p className="font-semibold">Thanks — your quote is in.</p>
        <p>We&apos;ll reach out if we have questions, and right away if the job is awarded. You can resubmit from this page to update your price.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount">Total price for the full scope ($) *</Label>
          <Input id="amount" name="amount" inputMode="decimal" placeholder="15000" required />
          <p className="text-xs text-muted-foreground">Include every period listed in the scope (base + options).</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead_time">Earliest start / time to complete</Label>
          <Input id="lead_time" name="lead_time" placeholder="Can start within 2 weeks" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Price breakdown, what&apos;s included, any exclusions</Label>
        <Textarea id="notes" name="notes" rows={5} placeholder="e.g. Base year $7,200 (12 monthly visits), each option year $7,400. Includes all labor, equipment and disposal. Excludes..." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <YesNo name="net30" label="Can you accept net-30 payment after the work is accepted?" required />
        <div className="space-y-1.5">
          <Label htmlFor="down_payment_pct">Deposit required (% of price), if any</Label>
          <Input id="down_payment_pct" name="down_payment_pct" inputMode="decimal" placeholder="0" />
        </div>
        <YesNo name="own_employees" label="Will the work be done by your own employees (not further subcontracted)?" required={requiresSmallBusiness} />
        <YesNo name="small_business" label="Is your company a small business (under the SBA size standard for this work)?" required={requiresSmallBusiness} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="references">Two references for similar work (company, contact, phone, what you did, when)</Label>
        <Textarea id="references" name="references" rows={4} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact_name">Your name</Label>
          <Input id="contact_name" name="contact_name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact_email">Email</Label>
          <Input id="contact_email" name="contact_email" type="email" defaultValue={defaults.contactEmail ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact_phone">Phone</Label>
          <Input id="contact_phone" name="contact_phone" defaultValue={defaults.contactPhone ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uei">SAM.gov UEI (if registered)</Label>
          <Input id="uei" name="uei" placeholder="Optional" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="file">Attach your written quote (PDF, optional, 4 MB max)</Label>
        <Input id="file" name="file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit quote"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={declining}
          onClick={() => {
            if (confirm("Let us know you're passing on this one?")) startDecline(() => declineQuote(token));
          }}
        >
          Not interested
        </Button>
      </div>
    </form>
  );
}
