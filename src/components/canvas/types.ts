export interface Point {
  x: number;
  y: number;
}

export interface PlacedPlant extends Point {
  id: string;
  typeId: string;
}

export interface ZoneServiceData {
  typeId: string;
  values: Record<string, string>;
  notes: string;
  photos: Blob[];
}

export interface WorkZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
  location: string;
  service: ZoneServiceData | null;
}

export interface StoredDesign {
  imageBlob: Blob | null;
  imageX: number;
  imageY: number;
  imageScale: number;
  imageRotation: number;
  locked: boolean;
  plants: PlacedPlant[];
  zones: WorkZone[];
}
