import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the evaluator role: their calendar, top to
 * bottom.
 */
export const evaluatorTour: Tour = {
  id: "evaluator-v2",
  title: "Your calendar",
  steps: [
    {
      title: "Today, on the map",
      body: "Your visits for the day, with a map of where they are. Today shows first.",
      target: "cal-day",
    },
    {
      title: "Tap a visit",
      body: "Tapping a visit zooms the map in on it. Its buttons appear underneath: Start evaluation, Directions, or open the file.",
      target: "cal-appointments",
    },
    {
      title: "Start evaluation",
      body: "At the property, tap Start evaluation. Measure each area, take photos, answer the questions, then Submit. You come back here.",
      target: "cal-appointments",
    },
    {
      title: "The whole month",
      body: "Under the day is the month. Tap any day to see its visits and map at the top.",
      target: "cal-month",
    },
    {
      title: "Your hours",
      body: "Set the days and hours you work. You're only booked when you're free. Mark a day off from the day at the top. The Help button brings this tour back any time.",
      target: "cal-hours",
    },
  ],
};
