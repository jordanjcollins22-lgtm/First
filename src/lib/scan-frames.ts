/**
 * A property scan from a phone video: the moments to take a still from, so
 * a 3D model can be built from them. A model needs every part of the yard
 * seen from several angles with lots of overlap; two stills a second of a
 * slow walk gives that, and capping the count keeps the upload and the
 * processing sensible however long the video runs.
 *
 * Pure, so it is tested without a video.
 */

export const SCAN_FRAMES_PER_SECOND = 2;
export const SCAN_MIN_FRAMES = 30;
export const SCAN_MAX_FRAMES = 240;
/** The long side of each still, in pixels: enough detail to match, small enough to upload on a phone. */
export const SCAN_FRAME_SIZE = 1600;

/** The seconds into the video to take each still at, evenly spaced, skipping the first and last half second of fumbling. */
export function scanFrameTimes(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const start = Math.min(0.5, durationSeconds / 10);
  const end = Math.max(start, durationSeconds - Math.min(0.5, durationSeconds / 10));
  const span = end - start;
  const count = Math.max(Math.min(SCAN_MIN_FRAMES, Math.floor(durationSeconds * 10)), Math.min(SCAN_MAX_FRAMES, Math.round(span * SCAN_FRAMES_PER_SECOND)));
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, i) => Math.round((start + (span * i) / (count - 1)) * 1000) / 1000);
}

/** The still's size, its long side at most SCAN_FRAME_SIZE. */
export function scanFrameSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= SCAN_FRAME_SIZE) return { width, height };
  const k = SCAN_FRAME_SIZE / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** Where a scan's stills live, in the public canvas-images bucket beside the job's other pictures. */
export function scanFolder(jobId: string, scanId: string): string {
  return `${jobId}/scans/${scanId}`;
}

export function scanFramePath(jobId: string, scanId: string, index: number): string {
  return `${scanFolder(jobId, scanId)}/frame-${String(index + 1).padStart(4, "0")}.jpg`;
}

export interface ScanManifest {
  scanId: string;
  jobId: string;
  frames: number;
  durationSeconds: number;
  width: number;
  height: number;
  /** The video's own file name, for whoever processes it. */
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}
