import { Loader2 } from "lucide-react";

/**
 * What a client sees while their map or their price is being put together.
 *
 * Without it the screen went blank for several seconds after "Next": the
 * county's lot lines and the aerial are fetched before the page can draw, and
 * a blank screen on a phone reads as broken. A plain sentence says it isn't.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center" aria-busy="true" aria-live="polite">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      <p className="text-lg font-semibold">Getting your property ready…</p>
      <p className="text-sm text-muted-foreground">This takes a few seconds.</p>
    </div>
  );
}
