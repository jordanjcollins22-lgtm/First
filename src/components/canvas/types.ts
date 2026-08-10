export interface Point {
  x: number;
  y: number;
}

export interface ZoneServiceData {
  typeId: string;
  values: Record<string, string>;
  notes: string;
  photos: Blob[];
  tools: string[];
}

export interface WorkZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
  location: string;
  service: ZoneServiceData | null;
  /** Manually entered — on-screen pixel measurements weren't reliable enough to trust. */
  areaSqFt: number | null;
  perimeterFt: number | null;
}

export interface StoredDesign {
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
}
