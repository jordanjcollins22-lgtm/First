import Link from "next/link";
import { ClipboardList } from "lucide-react";

/**
 * No pre-evaluation form from the client: the first thing on site is the
 * form, with them. Their answers save to the job, and the site map is set
 * up from them the same as if they had sent it ahead.
 */
export function PreEvalFirst({ formHref, skipHref, preview = false }: { formHref: string; skipHref: string; preview?: boolean }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">First: the pre-eval, with them</h2>
          <p className="text-sm text-muted-foreground">
            They haven&apos;t filled out the pre-evaluation form. Go through it together: hand them the phone or read the
            questions out. The site map is set up from their answers.
          </p>
        </div>
      </div>
      <Link
        href={preview ? "#" : formHref}
        className="inline-flex h-12 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground"
      >
        Fill out the pre-eval together
      </Link>
      <Link href={preview ? "#" : skipHref} className="self-center text-xs text-muted-foreground underline">
        Skip it and draw the map by hand
      </Link>
    </section>
  );
}
