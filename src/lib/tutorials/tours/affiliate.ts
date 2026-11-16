import type { Tour } from "@/lib/tutorials/types";

/**
 * The first-open tutorial for the affiliate role (a "commenter" too): answer
 * send the link to someone, answer a post, see what came of it and what it paid. Each step
 * points at the affiliate home screen (affiliate-home.tsx) or the comment
 * card inside it (comment-card.tsx: "card", "found").
 */
export const affiliateTour: Tour = {
  id: "affiliate-v1",
  title: "Welcome",
  steps: [
    {
      title: "Your day, on one screen",
      body: "Send your link to people you know, answer neighbors asking for yard work, and see what you earn. Tap Help any time to see this again.",
    },
    {
      title: "Send your link to someone",
      target: "affiliate-link",
      body: "Type who you're sending it to and pick how you know them. You get a message with your own link in it: tap Copy and send it. You'll see when they open it.",
    },
    {
      title: "Answer a post",
      target: "affiliate-posts",
      body: "Each card is a neighbor asking for yard help. Tap Use this comment and your own tracked link is added. Not a job? Tap Can't respond.",
    },
    {
      title: "Copy, paste, done",
      target: "card",
      body: "Tap Copy & go to post. Your reply is copied and the post opens. Paste it under the post; it's marked posted for you. Then tap Next post.",
    },
    {
      title: "Found one yourself?",
      target: "found",
      body: "Saw a post asking for yard work? Paste its link under Found a post. It comes to you next, with a reply written.",
    },
    {
      title: "See what came of it",
      target: "affiliate-results",
      body: "Clicks on your links, bookings, and every project you brought in, with where it has got to and your 4%.",
    },
    {
      title: "Your money",
      target: "affiliate-money",
      body: "What you've earned, what's been paid to you, and what's still owed. Only you see these numbers.",
    },
  ],
};
