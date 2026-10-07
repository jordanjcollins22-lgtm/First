import { CheckCircle2 } from "lucide-react";

/**
 * The end of the road: what happened, and who is picking it up.
 *
 * Deliberately has nothing to press. The client picking their own day meant
 * a job on the books that nobody had looked at the crew's week for, and a
 * page that could be reached by closing the card sheet without paying.
 */
export function BookedView({
  organizationName,
  heading,
  body,
  preview,
}: {
  organizationName: string;
  heading: string;
  body: string;
  preview: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">
        {organizationName}
      </p>

      {preview && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">
          Internal preview. Nothing here books anybody.
        </div>
      )}

      <CheckCircle2 className="h-10 w-10 text-primary" />
      <h1 className="text-2xl font-bold">{heading}</h1>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}
