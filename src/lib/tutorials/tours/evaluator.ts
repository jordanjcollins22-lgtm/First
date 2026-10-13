import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the evaluator role: one pass down their home
 * screen, in the order of their day.
 */
export const evaluatorTour: Tour = {
  id: "evaluator-v1",
  title: "Your day as an evaluator",
  steps: [
    {
      title: "Today's visits, in order",
      body: "Every visit booked with you today, earliest first, with the client's name and address.",
      target: "eval-today",
    },
    {
      title: "Getting there",
      body: "Tap On my way when you leave: it opens directions and tells the office. Call the client from here if you're running late.",
      target: "eval-directions",
    },
    {
      title: "Start visit",
      body: "Tap Start visit at the property. Go through each area: measure it, take photos, answer the questions. Then tap Submit evaluation and you come back here.",
      target: "eval-start",
    },
    {
      title: "What happened to your proposal",
      body: "After you submit, the price is worked out for you. Here you see if it went to the client, or was held for the office and why.",
      target: "eval-proposals",
    },
    {
      title: "Coming up",
      body: "Your visits for the next three weeks, with the client's phone.",
      target: "eval-upcoming",
    },
    {
      title: "Your hours",
      body: "Set the days and hours you work, and add any day off. You're only booked when you're free.",
      target: "eval-availability",
    },
    {
      title: "Your numbers",
      body: "Your close rate and your commission. The Help button brings this tour back any time.",
      target: "eval-numbers",
    },
  ],
};
