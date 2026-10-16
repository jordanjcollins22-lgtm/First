import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the project-technician role: the clock, then
 * their calendar.
 */
export const projectTechnicianTour: Tour = {
  id: "project-technician-v2",
  title: "Your calendar",
  steps: [
    {
      title: "Clock in",
      body: "Tap the job you're working on, or Yard / shop for time at the shop. Tap Clock out when you stop. Your hours are paid from this.",
      target: "crew-clock",
    },
    {
      title: "Today, on the map",
      body: "The jobs you're on today, with a map of where they are.",
      target: "cal-day",
    },
    {
      title: "Tap a job",
      body: "Tapping a job zooms the map in on it. Underneath: Directions, and the Job sheet with each area, its steps and photos.",
      target: "cal-appointments",
    },
    {
      title: "The whole month",
      body: "Under the day is the month. Tap any day to see what you're on. The Help button brings this tour back any time.",
      target: "cal-month",
    },
  ],
};
