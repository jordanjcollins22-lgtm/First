import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the owner role: open the app, see what needs
 * you, deal with it, leave. Pages, choices and sections are the whole map;
 * the approval queue, Integrations, Preview as and Help are where the
 * owner's week happens.
 */
export const ownerTour: Tour = {
  id: "owner-v1",
  title: "Welcome",
  steps: [
    {
      title: "Four pages",
      body: "Marketing, Sales, Operations and Admin. Each page is one part of the business. Tap a name to go there.",
      target: "pages",
    },
    {
      title: "A few choices on each page",
      body: "Along the top of a page sit its choices, like Digital marketing or Finance. Tap one to open it.",
      target: "choices",
    },
    {
      title: "Sections, then tap any row",
      body: "A choice opens into sections. The first show what needs you and the on/off switches; after the line come the records. Tap any row to open it and act on it.",
      target: "sections",
    },
    {
      title: "Your approval queue",
      body: "Admin › Oversight lists everything waiting on you, from every department, in one place. Turn on the Monday digest there and the list comes to you each week.",
    },
    {
      title: "Logins go in Integrations",
      body: "Admin › Settings › Integrations is where you paste logins for Google, Stripe and the rest. Secret keys are saved once and never shown again.",
    },
    {
      title: "See what your team sees",
      body: "Preview as shows the app exactly as one team member sees it, so you can help them. Pick Me (owner) to come back.",
      target: "preview-as",
    },
    {
      title: "Help is always here",
      body: "Tap Help any time to run this tour again.",
      target: "help",
    },
  ],
};
