import { AlertCircle, Check, X } from "lucide-react";

/**
 * The three things between an accepted proposal and money in the bank.
 *
 * Put at the top of Database setup because it is the question actually being
 * asked. "Which migrations are outstanding" is the mechanism; "can a client
 * pay me yet" is what somebody wants to know, and working it out from a list
 * of fifty file names on a phone is not reasonable.
 */
export function PaymentReadiness({
  columnsApplied,
  hasStripeKey,
  hasWebhookSecret,
}: {
  /** Null when the schema could not be checked at all. */
  columnsApplied: boolean | null;
  hasStripeKey: boolean;
  hasWebhookSecret: boolean;
}) {
  const checks = [
    {
      label: "Payment columns in the database",
      ok: columnsApplied,
      blocking: true,
      fix: "Run the outstanding migrations below.",
    },
    {
      label: "Stripe key",
      ok: hasStripeKey,
      blocking: true,
      fix: "Add STRIPE_SECRET_KEY in Vercel, then redeploy.",
    },
    {
      label: "Stripe webhook",
      ok: hasWebhookSecret,
      blocking: false,
      fix: "Add STRIPE_WEBHOOK_SECRET in Vercel. Clients can still pay without it, but the payment will not be recorded here.",
    },
  ];

  const blocked = checks.some((c) => c.blocking && c.ok !== true);

  return (
    <div
      className={`mb-4 rounded-xl border p-4 ${
        blocked ? "border-amber-400/60 bg-amber-50/60" : "border-emerald-600/40 bg-emerald-50/60"
      }`}
    >
      <p
        className={`text-sm font-semibold ${blocked ? "text-amber-900" : "text-emerald-800"}`}
      >
        {blocked ? "Clients cannot pay yet" : "Clients can pay"}
      </p>

      <ul className="mt-2.5 flex flex-col gap-2">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2">
            {check.ok === true ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            ) : check.ok === null ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium">{check.label}</p>
              {check.ok !== true && (
                <p className="text-[11px] text-muted-foreground">
                  {check.ok === null ? "Could not check. Reload and try again." : check.fix}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
