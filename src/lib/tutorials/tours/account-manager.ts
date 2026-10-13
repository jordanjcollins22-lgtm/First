import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the account-manager role (and the office,
 * which the new layout treats as one). It opens on Sales, where the day
 * starts, then points at Admin for the clients they already have.
 */
export const accountManagerTour: Tour = {
  id: "account-manager-v1",
  title: "Welcome",
  steps: [
    {
      title: "Your two pages",
      body: "Sales is for winning new work. Admin is for the clients you already have. Switch between them here.",
      target: "pages",
    },
    {
      title: "Call new leads first",
      body: "Ring each new lead with Call, then tap Book to pick the visit time and the evaluator. The newest leads are at the top.",
      target: "am-book",
    },
    {
      title: "Check and approve prices",
      body: "When an evaluator writes up a proposal it waits here. Open it, check the price, then approve it or set a different one.",
      target: "am-approve",
    },
    {
      title: "Follow up proposals",
      body: "Proposals the client hasn't answered, warmest first. Call them, tap what they said and save. The list says who to ring next.",
      target: "am-follow-up",
    },
    {
      title: "Your clients are on Admin",
      body: "On Admin: messages to answer, invoices still unpaid, your clients and anything wrong on their jobs, and your commission.",
      target: "pages",
    },
    {
      title: "Tap a name for everything",
      body: "Any name or Open button shows the details and what you can do: book, approve, resend, record a payment or add a note.",
    },
    {
      title: "Help is always here",
      body: "Tap Help any time to see this again.",
      target: "help",
    },
  ],
};
