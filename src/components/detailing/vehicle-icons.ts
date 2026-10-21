import { Car, Caravan, CarFront, Motorbike, Sailboat, Truck, type LucideIcon } from "lucide-react";

import type { VehicleSize } from "@/lib/detailing";

export const vehicleIcons: Record<VehicleSize, LucideIcon> = {
  sedan: Car,
  suv: CarFront,
  truck: Truck,
  boat: Sailboat,
  rv: Caravan,
  motorcycle: Motorbike,
};
