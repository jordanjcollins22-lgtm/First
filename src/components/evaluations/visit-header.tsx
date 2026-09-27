import Link from "next/link";
import { Navigation, Phone } from "lucide-react";

import { VisitAction } from "@/components/evaluations/visit-action";
import type { VisitStage } from "@/lib/evaluation-visit";

/** The top of a visit: when, who, where, the ways to reach them, and the visit button. */
export function VisitHeader({
  jobId,
  when,
  client,
  address,
  phone,
  stage,
  arrivedAt,
  timeZone,
  preview = false,
}: {
  jobId: string;
  when: string | null;
  client: string;
  address: string;
  phone: string | null;
  stage: VisitStage;
  arrivedAt: string | null;
  timeZone: string;
  preview?: boolean;
}) {
  const link = (href: string) => (preview ? "#" : href);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div>
        {when && <p className="text-sm font-semibold text-primary">{when}</p>}
        <h1 className="text-2xl font-bold leading-tight">{client}</h1>
        <p className="text-sm text-muted-foreground">{address}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={preview ? "#" : `tel:${phone}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium">
            <Phone className="h-4 w-4" /> Call
          </a>
        )}
        <Link href={link(`/jobs/${jobId}/directions`)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium">
          <Navigation className="h-4 w-4" /> Directions
        </Link>
        <Link href={link(`/jobs/${jobId}`)} className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm font-medium">
          Full project
        </Link>
      </div>
      <VisitAction jobId={jobId} stage={stage} arrivedAt={arrivedAt} timeZone={timeZone} openVisitAfterArrive={false} preview={preview} />
    </section>
  );
}
