import Link from "next/link";
import { Play } from "lucide-react";

/**
 * The one button after arriving: Start the evaluation, which opens the site
 * map already set up from the client's pre-eval.
 */
export function StartEvaluation({ href, areas, preview = false }: { href: string; areas: number; preview?: boolean }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
      <Link
        href={preview ? "#" : href}
        className="inline-flex h-14 items-center justify-center gap-2 rounded-md bg-primary text-base font-semibold text-primary-foreground"
      >
        <Play className="h-5 w-5" /> Start the evaluation
      </Link>
      <p className="text-center text-sm text-muted-foreground">
        {areas > 0
          ? `Opens the site map with their pre-eval laid over it: ${areas} ${areas === 1 ? "thing" : "things"} they asked for. Tick or cross each one there, and add anything else.`
          : "Opens the site map to draw each area."}
      </p>
    </section>
  );
}
