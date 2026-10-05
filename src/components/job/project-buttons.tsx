import Link from "next/link";
import { Camera, ClipboardList, FileText, Map } from "lucide-react";

/**
 * The four things a project is made of, one tap each: the proposal the
 * client saw, the site map (what is being done and what it needs), the crew
 * sheet (how, with what), and the progress photos. Greyed out until there
 * is one to open.
 */
export function ProjectButtons({
  jobId,
  proposalHref,
  hasSiteMap,
  photoCount,
  managerView = false,
}: {
  jobId: string;
  /** The client's own copy of the proposal. Null until one exists. */
  proposalHref: string | null;
  hasSiteMap: boolean;
  photoCount: number;
  /** Whoever runs jobs gets the whole crew sheet at once; the crew get theirs one area at a time. */
  managerView?: boolean;
}) {
  const buttons = [
    { key: "proposal", label: "Proposal", icon: FileText, href: proposalHref, external: true, empty: "Not built yet" },
    { key: "site-map", label: "Site map", icon: Map, href: hasSiteMap ? `/jobs/${jobId}/site-map` : null, external: false, empty: "Not drawn yet" },
    { key: "crew-sheet", label: "Crew sheet", icon: ClipboardList, href: hasSiteMap ? `/jobs/${jobId}/${managerView ? "crew-overview" : "work-order"}` : null, external: false, empty: "Needs the site map" },
    {
      key: "photos",
      label: "Progress photos",
      icon: Camera,
      href: photoCount > 0 ? `/jobs/${jobId}/photos` : null,
      external: false,
      empty: "None yet",
    },
  ];
  return (
    <div className="flex flex-col gap-1.5">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {buttons.map(({ key, label, icon: Icon, href, external, empty }) =>
        href ? (
          <Link
            key={key}
            href={href}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-white/60 bg-card/60 px-2 py-3 text-sm font-medium backdrop-blur-md hover:bg-accent/50"
          >
            <Icon className="h-5 w-5 text-primary" />
            {label}
            {key === "photos" && <span className="text-xs font-normal text-muted-foreground">{photoCount}</span>}
          </Link>
        ) : (
          <div
            key={key}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-2 py-3 text-sm text-muted-foreground"
            aria-disabled
          >
            <Icon className="h-5 w-5" />
            {label}
            <span className="text-xs">{empty}</span>
          </div>
        )
      )}
    </div>
    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
      {/* A walk-around video, for a 3D model and a top-down plan of the yard. */}
      <Link href={`/jobs/${jobId}/scan`} className="text-xs font-medium text-primary hover:underline">
        3D scan from a video (demo)
      </Link>
      {/* The crew's own screens for this job, to click through. Saves nothing. */}
      {hasSiteMap && (
        <Link href={`/jobs/${jobId}/crew-demo`} className="text-xs font-medium text-primary hover:underline">
          Click through the crew sheet (demo)
        </Link>
      )}
    </div>
    </div>
  );
}
