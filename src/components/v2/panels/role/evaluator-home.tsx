import { MyCalendarPanel } from "@/components/v2/panels/role/my-calendar";

/**
 * The evaluator's home screen in the new layout: their calendar, the day on
 * top with its map and the month under it. Tapping a visit zooms the map in
 * on it, with Start evaluation, Directions and the file underneath.
 */
export async function EvaluatorHomePanel() {
  return <MyCalendarPanel mode="evaluator" />;
}
