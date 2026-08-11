export const ATTRACTOR_TYPE_COLORS: Record<string, string> = {
  moving: "#f59e0b",
  stationary: "#3b82f6",
  one_off: "#a855f7",
  digital: "#06b6d4",
};
const DEFAULT_TYPE_COLOR = "#22c55e";

export function colorForAttractorType(typeId: string): string {
  return ATTRACTOR_TYPE_COLORS[typeId] ?? DEFAULT_TYPE_COLOR;
}

export const JOB_STATUS_COLORS: Record<string, string> = {
  estimating: "#9ca3af",
  quoted: "#60a5fa",
  approved: "#818cf8",
  in_progress: "#f59e0b",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

export function colorForJobStatus(status: string): string {
  return JOB_STATUS_COLORS[status] ?? "#9ca3af";
}

/** Business locations render as a distinct "home base" gold, separate from
 * wave types and job statuses. */
export const LOCATION_COLOR = "#fbbf24";
