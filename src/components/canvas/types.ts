import type { CanvasMark } from "@/lib/canvas-marks";

export interface Point {
  x: number;
  y: number;
}

export interface ZoneServiceData {
  typeId: string;
  values: Record<string, string>;
  notes: string;
  /** Storage paths in the "canvas-images" bucket, uploaded as soon as they're picked. */
  photos: string[];
  /**
   * Tap-placed markers on individual photos, keyed by the photo's storage
   * path. Each point is a fraction (0–1) of the image's width/height, not a
   * pixel coordinate, so markers stay put regardless of how large the photo
   * is displayed.
   */
  photoMarkers?: Record<string, Point[]>;
  /** Auto-attached from the service's tool checklist — the evaluator doesn't pick these. */
  tools: string[];
  /** Manually added extra materials for this zone, beyond what the service already uses. */
  materials?: string[];
  /** What the customer wants for each material, keyed by material name: type and color. */
  materialChoices?: Record<string, { type?: string; color?: string }>;
}

export interface WorkZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
  location: string;
  service: ZoneServiceData | null;
  /**
   * Measured on site as length x width; area and perimeter are derived from
   * them. On-screen pixel measurements weren't reliable enough to trust.
   * Older zones may have area/perimeter with no length/width behind them.
   */
  lengthFt?: number | null;
  widthFt?: number | null;
  areaSqFt: number | null;
  perimeterFt: number | null;
}

export interface StoredDesign {
  /** Notes pinned to points on the picture. */
  marks?: CanvasMark[];
  imageBlob: Blob | null;
  imageX: number;
  imageY: number;
  imageScale: number;
  imageRotation: number;
  /** Real-world feet spanned by the background image's full native width, if known. */
  imageRealWidthFeet: number | null;
  locked: boolean;
  address: string;
  zones: WorkZone[];
  /** A rough property boundary drawn once, up front, before work zones. */
  propertyLine: Point[];
  /** A single pin marking the house, drawn before the property line. */
  houseOutline: Point[];
}
