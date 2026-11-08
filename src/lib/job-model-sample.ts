/**
 * A made-up job for the review page: a front foundation bed being renewed,
 * a new island by the walk and a rock bed beside the driveway, on a typical
 * Bel Air lot. Nothing here is a real client.
 */

import * as turf from "@turf/turf";

import type { LngLat, ModelArea, ModelPlant, StoredJobModel } from "@/lib/job-model";

export const SAMPLE_JOB_ID = "sample";

/** The middle of the house. */
export const SAMPLE_CENTER: LngLat = [-76.34105, 39.53495];

/** A point so many feet east and north of the house's middle. */
function off(eastFt: number, northFt: number): LngLat {
  const east = turf.destination(SAMPLE_CENTER, Math.abs(eastFt), eastFt >= 0 ? 90 : 270, { units: "feet" }).geometry.coordinates as LngLat;
  return turf.destination(east, Math.abs(northFt), northFt >= 0 ? 0 : 180, { units: "feet" }).geometry.coordinates as LngLat;
}

export const SAMPLE_ADDRESS = "Sample job · Bel Air, MD";

export const SAMPLE_AREAS: ModelArea[] = [
  {
    id: "front-bed",
    name: "Front foundation bed",
    color: "#f59e0b",
    ring: [off(-26, -16), off(10, -16), off(10, -24), off(-4, -27), off(-26, -24)],
    typeId: "landscape-bed",
    service: "Landscape Bed",
    values: {
      bedWork: "Renewal",
      material: "Mulch",
      color: "Brown",
      existingMaterial: "Mulch",
      existingMaterialCondition: "Normal",
      weedLevel: "Moderate",
      edge: "Existing Edge Needs Redone",
      bushRemoval: "Select Bushes",
      newPlantInstallation: "Select Plants",
    },
  },
  {
    id: "island",
    name: "Lamp post island",
    color: "#8b5cf6",
    ring: [off(-20, -38), off(-8, -36), off(-4, -44), off(-10, -52), off(-22, -49)],
    typeId: "landscape-bed",
    service: "Landscape Bed",
    values: { bedWork: "New Creation", material: "Mulch", color: "Black", existingMaterial: "None", weedLevel: "None", edge: "No Edge", newPlantInstallation: "Select Plants" },
  },
  {
    id: "drive-bed",
    name: "Rock bed by the driveway",
    color: "#0ea5e9",
    ring: [off(26, 14), off(32, 14), off(32, -18), off(26, -18)],
    typeId: "landscape-bed",
    service: "Landscape Bed",
    values: { bedWork: "Renewal", material: "Rock", rockSize: "Medium", existingMaterial: "Mulch", existingMaterialCondition: "Needs Removal", weedLevel: "Light", edge: "Existing Good Edge", plantRemoval: "Select Plants" },
  },
];

const plant = (id: string, name: string, status: ModelPlant["status"], heightFt: number, spreadFt: number, areaId: string, at: LngLat): ModelPlant => ({ id, name, status, heightFt, spreadFt, areaId, at });

export const SAMPLE_PLANTS: ModelPlant[] = [
  plant("p1", "Japanese maple", "keep", 8, 8, "front-bed", off(-21, -20)),
  plant("p2", "Boxwood", "keep", 2.5, 2.5, "front-bed", off(-14, -19)),
  plant("p3", "Boxwood", "keep", 2.5, 2.5, "front-bed", off(-10, -19)),
  plant("p4", "Boxwood", "keep", 2.5, 2.5, "front-bed", off(-6, -19)),
  plant("p5", "Overgrown yew", "remove", 6, 7, "front-bed", off(3, -20)),
  plant("p6", "Dead azalea", "remove", 3, 3, "front-bed", off(-2, -23)),
  plant("p7", "Limelight hydrangea", "new", 3, 3, "front-bed", off(1, -21)),
  plant("p8", "Limelight hydrangea", "new", 3, 3, "front-bed", off(6, -21)),
  plant("p9", "Crape myrtle", "new", 6, 3, "island", off(-13, -44)),
  plant("p10", "Karl Foerster grass", "new", 3, 1.5, "island", off(-17, -46)),
  plant("p11", "Karl Foerster grass", "new", 3, 1.5, "island", off(-9, -47)),
  plant("p12", "Karl Foerster grass", "new", 3, 1.5, "island", off(-14, -49)),
  plant("p13", "Emerald arborvitae", "keep", 9, 3, "drive-bed", off(29, 10)),
  plant("p14", "Emerald arborvitae", "keep", 9, 3, "drive-bed", off(29, 3)),
  plant("p15", "Overgrown forsythia", "remove", 6, 6, "drive-bed", off(29, -8)),
];

/** The house, about 50 by 32 feet. */
export const SAMPLE_HOUSE: LngLat[] = [off(-25, 16), off(25, 16), off(25, -16), off(-25, -16), off(-25, 16)];

/** Where the truck parks: the bottom of the driveway. */
export const SAMPLE_TRUCK: LngLat = off(38, -62);

export const SAMPLE_MODEL: StoredJobModel = { plants: SAMPLE_PLANTS, steps: [], truck: SAMPLE_TRUCK, videoUrl: null };

/** Before photos that ship with the site, for the photo suggestions on the review page. */
export const SAMPLE_PHOTOS = [
  { url: "/booking-work/front-bed-mulch-trim.jpg", areaId: "front-bed", file: "public/booking-work/front-bed-mulch-trim.jpg" },
  { url: "/booking-work/overgrowth-removal-mulch.jpg", areaId: "drive-bed", file: "public/booking-work/overgrowth-removal-mulch.jpg" },
];
