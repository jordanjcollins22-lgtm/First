import { ExternalLink } from "lucide-react";

export function MaterialBuyLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Buy
    </a>
  );
}
