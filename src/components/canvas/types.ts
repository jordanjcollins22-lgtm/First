export interface Point {
  x: number;
  y: number;
}

export interface PlacedPlant extends Point {
  id: string;
  typeId: string;
}

export interface ZoneService {
  name: string;
  trim: number;
  remove: number;
  plantNew: number;
}

export interface WorkZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
  location: string;
  service: ZoneService | null;
  areaPhoto: Blob | null;
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
