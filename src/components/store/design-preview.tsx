import { cn } from "@/lib/utils";

/**
 * Shows a rendered design. It's drawn as an <img>, so nothing inside an
 * uploaded SVG can run in the page.
 */
export function DesignPreview({ svg, alt, className }: { svg: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt={alt}
      className={cn("h-auto w-full rounded-md border border-border bg-white shadow-sm", className)}
    />
  );
}
