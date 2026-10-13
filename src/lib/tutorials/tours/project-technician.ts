import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the project-technician role: the crew's whole
 * day on one screen, top to bottom, in the order it happens.
 */
export const projectTechnicianTour: Tour = {
  id: "project-technician-v1",
  title: "Your day",
  steps: [
    {
      title: "Your whole day is here",
      body: "Everything for today is on this one screen. Work from the top down. The big button always shows the one thing to do next.",
      target: "crew-today",
    },
    {
      title: "Clock in",
      body: "Tap the job you're working on, or Yard / shop for time at the shop. Tap Clock out when you stop.",
      target: "crew-clock",
    },
    {
      title: "Load the truck",
      body: "At the shop, tap I'm at the shop, then tick each kit and material as it goes on the truck. You can leave once everything is ticked.",
      target: "crew-today",
    },
    {
      title: "Drive and arrive",
      body: "Tap On my way and your maps app opens with directions. Tap I've arrived when you get there.",
      target: "crew-today",
    },
    {
      title: "Do the work and take photos",
      body: "The job sheet shows each area. Start an area, tick its steps and take its photos. Something wrong on site? Report it at the bottom of the sheet.",
      target: "crew-sheet",
    },
    {
      title: "Finish and move on",
      body: "Tap Finished here when the job is done and the next stop shows up. After the last one, log the machine hours and tap Back at the shop.",
      target: "crew-today",
    },
    {
      title: "No work, or a storm",
      body: "No work today? You'll see your next day here. On a storm day the snow route is at the top: log each stop with a photo.",
    },
  ],
};
