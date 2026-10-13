import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the project-lead role: the crew's day, plus
 * the five things the lead answers for.
 */
export const projectLeadTour: Tour = {
  id: "project-lead-v1",
  title: "Leading the job",
  steps: [
    {
      title: "Your day comes first",
      body: "Your own day runs like the crew's: clock in, load the truck, drive, work, finish. The big button always shows your next step.",
      target: "crew-today",
    },
    {
      title: "Who's here, who's late",
      body: "Everyone on your jobs today, with where they are. Anyone late is at the top. Tap the phone to call them.",
      target: "lead-crew",
    },
    {
      title: "Hours left on budget",
      body: "Each job's hours used against what it was priced for. Running close? Raise it before it runs over, not after.",
      target: "lead-budget",
    },
    {
      title: "Materials in hand",
      body: "What today's jobs need and whether it's ticked as on the truck. Short of something? Raise it as an issue on that job.",
      target: "lead-materials",
    },
    {
      title: "Raise an issue",
      body: "Can't get in, the client wants something else, equipment broke: report it here. The office gets it straight away.",
      target: "lead-issues",
    },
    {
      title: "Walkthrough and sign-off",
      body: "When the work is done, ask for the final walkthrough with the tools still out. Once it's approved, sign the job off, then tap Finished here.",
      target: "lead-closeout",
    },
  ],
};
