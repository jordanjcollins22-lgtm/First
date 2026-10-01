/**
 * The affiliate tutorial: the steps, in the order the work happens, each
 * pointing at the part of the Posts to Answer screen it is about. A step
 * whose part is not on the screen right now (no post to answer, nothing
 * answered yet) is still shown, in the middle, so the story is the same
 * for everybody.
 */

export interface TutorialStep {
  key: string;
  /** The data-tour name of what to point at. Null for a step in the middle of the screen. */
  target: string | null;
  /**
   * What the button there turns into, drawn over it for this step: the
   * button shows one thing until it is tapped, and the step is about the next.
   */
  becomes?: string;
  title: string;
  body: string;
}

/** Where a finished tutorial is remembered, on the person's own sign-in. */
export const AFFILIATE_TUTORIAL_KEY = "affiliate_tutorial_done_at";

export const AFFILIATE_TUTORIAL: TutorialStep[] = [
  {
    key: "welcome",
    target: null,
    title: "Welcome to the team!",
    body: "You help neighbors who are asking for yard work find us. When they hire us through your link, it counts for you. Let's walk through it. It takes about a minute.",
  },
  {
    key: "card",
    target: "card",
    title: "Your post card",
    body: "Every post here is a real person near us asking for yard work. The app finds them for you and shows them one at a time.",
  },
  {
    key: "post",
    target: "post",
    title: "What they need",
    body: "Read what they're asking for. Just above it is when it was posted. The fresher the post, the better your chances, so answer new ones first.",
  },
  {
    key: "comment",
    target: "comment",
    title: "Your comment, already written",
    body: "We write a comment for every post. Change anything you like. [your link] turns into your own link. That's how we know they came from you.",
  },
  {
    key: "use",
    target: "respond",
    title: "Use this comment",
    body: "Tap Use this comment. Your own link is added, and the button turns into Copy & go to post.",
  },
  {
    key: "copy",
    target: "respond",
    becomes: "Copy & go to post",
    title: "Copy & go to post",
    body: "Tap Copy & go to post. Your comment is copied and the post opens. Paste it as a comment from your own Facebook account, then come back and tap Next post.",
  },
  {
    key: "cant",
    target: "cant",
    title: "Not one for us?",
    body: "If it's an ad, not yard work, too far away, or they already found someone, tap Can't respond and pick why. The next post comes right up.",
  },
  {
    key: "found",
    target: "found",
    title: "Found one yourself?",
    body: "See someone asking for yard work? On Facebook tap Share, then Copy link, and paste it here. Add a screenshot if you have one.",
  },
  {
    key: "recent",
    target: "recent",
    title: "Lost your comment?",
    body: "Clicked away before you pasted? Your recent answers keep each comment, so you can copy it again and go back to the post.",
  },
  {
    key: "leaderboard",
    target: "leaderboard",
    title: "The leaderboard",
    body: "See how everyone is doing: links put out, jobs booked, and jobs closed.",
  },
  {
    key: "answered",
    target: "answered",
    title: "Follow your posts",
    body: "Open Your answered posts to see what happened with each one: No clicks yet, Clicked, Evaluation booked, Proposal sent, Closed.",
  },
  {
    key: "done",
    target: null,
    title: "You're ready!",
    body: "Go answer your first post. Need a refresher? Tap the ? in the bottom corner any time to go through this again.",
  },
];
