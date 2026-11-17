import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the project-technician role, in the order of
 * their page (tech-home.tsx): today with the clock, their link, their wallet,
 * and their stages.
 */
export const projectTechnicianTour: Tour = {
  id: "project-technician-v3",
  title: "Your day",
  steps: [
    {
      title: "Clock in, and today's jobs",
      body: "Tap the job you're on, or Yard / shop. Tap Clock out when you stop: your hours are paid from this. Today's jobs are under it. Tap one for its job sheet.",
      target: "crew-clock",
    },
    {
      title: "Send your link to someone",
      body: "Anyone who needs yard work. Say who it's for and get a message with your own link. You earn 4% of every job it brings in, once the client pays.",
      target: "affiliate-link",
    },
    {
      title: "Your wallet",
      body: "Your 4% lands here once the client pays. Ask for a payout from here.",
      target: "affiliate-money",
    },
    {
      title: "Stages of Success",
      body: "Your track as a technician and what's next. Your account manager marks each stage when you reach it. The Help button brings this tour back any time.",
      target: "affiliate-stage",
    },
  ],
};
