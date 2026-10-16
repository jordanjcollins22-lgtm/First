import { MyCalendarPanel } from "@/components/v2/panels/role/my-calendar";

/**
 * The crew's home screen in the new layout: the clock, then their calendar,
 * the day on top with its map and the month under it. Tapping a job zooms
 * the map in on it, with Directions and the job sheet underneath.
 */
export async function CrewHomePanel() {
  return <MyCalendarPanel mode="crew" />;
}
