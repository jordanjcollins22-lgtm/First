import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  new: "bg-secondary text-secondary-foreground",
  sourcing: "bg-amber-100 text-amber-900",
  awaiting_quotes: "bg-amber-100 text-amber-900",
  ready: "bg-primary text-primary-foreground",
  submitted: "bg-blue-100 text-blue-900",
  won: "bg-emerald-600 text-white",
  lost: "bg-zinc-200 text-zinc-700",
  no_bid: "bg-zinc-100 text-zinc-500",
  expired: "bg-zinc-100 text-zinc-500",
  bid: "bg-primary text-primary-foreground",
  maybe: "bg-amber-100 text-amber-900",
};

const LABELS: Record<string, string> = {
  awaiting_quotes: "awaiting quotes",
  no_bid: "no-bid",
  ready: "ready to submit",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn("border-transparent whitespace-nowrap", STATUS_STYLES[status] ?? "bg-secondary")}>
      {LABELS[status] ?? status.replace(/_/g, " ")}
    </Badge>
  );
}
