import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the affiliate role (a "commenter" too): send
 * the link to someone, see how far each person got, the wallet
 * and the next stage. Each step
 * points at the affiliate home screen (affiliate-home.tsx) or the comment
 * card inside it (comment-card.tsx: "card", "found").
 */
export const affiliateTour: Tour = {
  id: "affiliate-v1",
  title: "Welcome",
  steps: [
    {
      title: "Your day, on one screen",
      body: "Send your link to people you know, see how far each one got, and watch your wallet. Tap Help any time to see this again.",
    },
    {
      title: "Send your link to someone",
      target: "affiliate-link",
      body: "Tap the button, type their name and pick how you know them. Found someone asking online? Pick Someone online and add a screenshot. You get a message with your link in it to copy and send.",
    },
    {
      title: "People you sent it to",
      target: "affiliate-results",
      body: "Everyone you sent your link to, and how far they got: sent, opened, booked, sold. Once it's sold you see your 4%.",
    },
    {
      title: "Your wallet",
      target: "affiliate-money",
      body: "Your 4% lands here once the client pays. Tap Request payout and the office approves it and sends it to your bank.",
    },
    {
      title: "Your next stage",
      target: "affiliate-stage",
      body: "Where you are on the Stages of Success, and what the next one asks.",
    },
  ],
};
