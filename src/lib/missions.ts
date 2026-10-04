/**
 * The mission board: the ways a team member brings work in that no software
 * can do for them, as missions with a number to hit.
 *
 * They pick a category, like a Jeopardy board; the app picks the mission,
 * preferring one they have not done lately, and hands them the goal, the
 * steps and the words, written with their name and their link. Pure, so the
 * picking and the wording are tested.
 */

export interface MissionContext {
  /** Their first name, as they would sign a text. */
  first: string;
  /** Their own booking link: anything booked through it is theirs. */
  link: string;
}

export interface Mission {
  key: string;
  title: string;
  goal: number;
  /** What one tap of +1 counts. */
  unit: string;
  /** How long a strong effort takes, so the clock means something. */
  target: string;
  steps: string[];
  scripts: (ctx: MissionContext) => { label: string; text: string }[];
}

export interface MissionCategory {
  key: string;
  title: string;
  /** One line under the title on the board. */
  blurb: string;
  missions: Mission[];
}

export const MISSION_CATEGORIES: MissionCategory[] = [
  {
    key: "people",
    title: "People you know",
    blurb: "Friends, family, church, teams, old coworkers",
    missions: [
      {
        key: "people-100",
        title: "Reach out to 100 people you know",
        goal: 100,
        unit: "people reached",
        target: "Strong: 3 days",
        steps: [
          "Open your contacts and start at A. Family, friends, church, teams, old coworkers.",
          "Send each one the text below, with one before-and-after photo.",
          "Tap +1 for every person you send it to.",
          "When someone answers yes, add them with Add a lead.",
        ],
        scripts: ({ first, link }) => [
          { label: "Text", text: `Hey! It's ${first}. I'm working with JS Landscaping now: bed cleanups, mulch, planting and installs. If you or anyone you know wants their yard done, the evaluation is free: ${link}` },
        ],
      },
      {
        key: "people-post",
        title: "Tell everyone on your page",
        goal: 1,
        unit: "post made",
        target: "Strong: today",
        steps: [
          "Post on your own Facebook and Instagram that you work with JS Landscaping.",
          "Add your best before-and-after photo.",
          "Put your link in the post and in your bio.",
          "Tap +1 when it's up, then reply to every comment.",
        ],
        scripts: ({ link }) => [
          { label: "Post", text: `Big news: I'm part of the JS Landscaping crew now 🌿 We do bed cleanups, mulch, planting and installs around Harford County. If your yard needs some love, book a free evaluation with me here: ${link}` },
        ],
      },
      {
        key: "people-share",
        title: "Get 10 people to share your post",
        goal: 10,
        unit: "shares",
        target: "Strong: 5 days",
        steps: [
          "Ask family and close friends to share your post to their pages.",
          "Thank each person who shares.",
          "Tap +1 for every share.",
        ],
        scripts: ({ first }) => [
          { label: "Ask", text: `Hey, it's ${first}! Would you share my post about the landscaping work? Every job that comes from it helps me a ton. Thank you!` },
        ],
      },
    ],
  },
  {
    key: "comments",
    title: "Comments",
    blurb: "Answer local \"anyone know a landscaper?\" posts",
    missions: [
      {
        key: "comments-join",
        title: "Join 10 local Facebook groups",
        goal: 10,
        unit: "groups joined",
        target: "Strong: today",
        steps: [
          "Search Facebook for your town, nearby towns, moms groups and buy-sell groups.",
          "Join any group with active local homeowners.",
          "Turn on notifications for the busiest ones.",
          "Tap +1 for each group you join.",
        ],
        scripts: () => [{ label: "Searches to try", text: "Bel Air community · Fallston moms · Abingdon neighbors · Harford County buy sell trade · Forest Hill · Aberdeen MD community" }],
      },
      {
        key: "comments-answer",
        title: "Answer 10 \"anyone know a landscaper?\" posts",
        goal: 10,
        unit: "posts answered",
        target: "Strong: 7 days",
        steps: [
          "Search your groups for \"landscaper\", \"mulch\" and \"yard\" once a day.",
          "Answer as yourself within the first hour, with one photo.",
          "Tap +1 for every post you answer.",
        ],
        scripts: ({ first, link }) => [
          { label: "Reply", text: `Hi! ${first} here, I work with JS Landscaping. We just did a yard like this nearby. Happy to take a look at yours for free: ${link}` },
        ],
      },
      {
        key: "comments-nextdoor",
        title: "Recommend us on Nextdoor 5 times",
        goal: 5,
        unit: "recommendations",
        target: "Strong: 7 days",
        steps: [
          "Open Nextdoor and search \"landscaping\" and \"yard\".",
          "Recommend JS Landscaping on posts asking for help.",
          "Tap +1 for each one.",
        ],
        scripts: ({ link }) => [{ label: "Recommendation", text: `JS Landscaping did great work around here: cleanups, mulch, planting. Free evaluation: ${link}` }],
      },
    ],
  },
  {
    key: "posts",
    title: "Before & after",
    blurb: "Your own posts of the work your crew did",
    missions: [
      {
        key: "posts-week",
        title: "Post 3 before-and-afters this week",
        goal: 3,
        unit: "posts",
        target: "Strong: 7 days",
        steps: [
          "Take the before and after from the same spot.",
          "Post on your own page and tag the town.",
          "Add your link. Tap +1 for each post.",
        ],
        scripts: ({ link }) => [{ label: "Caption", text: `My crew did this today 💪 Before and after. Want yours done? Free evaluation: ${link}` }],
      },
      {
        key: "posts-video",
        title: "Post a 30-second walk-through video",
        goal: 1,
        unit: "video",
        target: "Strong: today",
        steps: [
          "Film a slow walk around the finished yard, talking about what you did.",
          "Post it to your stories and your page with your link.",
          "Tap +1 when it's up.",
        ],
        scripts: ({ first, link }) => [{ label: "What to say", text: `Hey, it's ${first} with JS Landscaping. Here's what we finished today: new edging, fresh mulch and the beds cleaned up. If you want yours looking like this, the link's in my bio: ${link}` }],
      },
      {
        key: "posts-groups",
        title: "Share our before-and-afters to 5 local groups",
        goal: 5,
        unit: "groups shared to",
        target: "Strong: 3 days",
        steps: [
          "Share the company's latest before-and-after post to local groups that allow business posts.",
          "Add one line about your part in it.",
          "Tap +1 for each group.",
        ],
        scripts: ({ link }) => [{ label: "Line to add", text: `My crew did this one 🌿 Free evaluations around Harford County: ${link}` }],
      },
    ],
  },
  {
    key: "hangers",
    title: "Door hangers",
    blurb: "The houses around every job",
    missions: [
      {
        key: "hangers-25",
        title: "Hang 25 door hangers around today's job",
        goal: 25,
        unit: "hangers",
        target: "Strong: today",
        steps: [
          "Start with the houses next door and across the street, then the rest of the street.",
          "Houses with overgrown beds or bare mulch first.",
          "Write your name on each one.",
          "Tap +1 for each hanger.",
        ],
        scripts: ({ first }) => [{ label: "Write on the hanger", text: `Ask for ${first}!` }],
      },
      {
        key: "hangers-knock",
        title: "Knock on 10 doors near the job",
        goal: 10,
        unit: "doors knocked",
        target: "Strong: today",
        steps: [
          "While the crew works, knock on the houses around the job.",
          "Say the line below, hand over a door hanger, and take their name and number if they're interested.",
          "Tap +1 for every door. Add the yeses with Add a lead.",
        ],
        scripts: ({ first }) => [{ label: "What to say", text: `Hi, I'm ${first} with JS Landscaping. We're doing the yard right there. Want a free look at yours while we're in the neighborhood?` }],
      },
      {
        key: "hangers-home",
        title: "Hang 50 in your own neighborhood",
        goal: 50,
        unit: "hangers",
        target: "Strong: a weekend",
        steps: [
          "Your neighbors already know your face. Start on your own street.",
          "Write your name on each one.",
          "Tap +1 for each hanger.",
        ],
        scripts: ({ first }) => [{ label: "Write on the hanger", text: `Your neighbor ${first} works here. Ask for me!` }],
      },
    ],
  },
  {
    key: "events",
    title: "Networking events",
    blurb: "Chamber, BNI, markets, home shows",
    missions: [
      {
        key: "events-attend",
        title: "Go to 1 event and have 5 real conversations",
        goal: 5,
        unit: "conversations",
        target: "Strong: this week",
        steps: [
          "Pick one: Chamber of Commerce, a BNI chapter, a farmers market, a home show, an HOA meeting.",
          "Wear the company shirt. Have before-and-afters ready on your phone.",
          "Give the intro below, then get their name and number.",
          "Tap +1 for every real conversation. Add the leads the same day.",
        ],
        scripts: ({ first }) => [{ label: "15-second intro", text: `I'm ${first} with JS Landscaping. We clean up beds, mulch, plant and install around Harford County, and the evaluation is free.` }],
      },
      {
        key: "events-followup",
        title: "Follow up with everyone you met within 24 hours",
        goal: 5,
        unit: "follow-ups",
        target: "Strong: 24 hours",
        steps: [
          "Text everyone whose number you got.",
          "Send one photo and your link.",
          "Tap +1 for each one.",
        ],
        scripts: ({ first, link }) => [{ label: "Text", text: `Great meeting you! It's ${first} from JS Landscaping. Here's the kind of work we do. If you ever want a free look at your yard: ${link}` }],
      },
      {
        key: "events-partners",
        title: "Meet 3 people who send work",
        goal: 3,
        unit: "partners met",
        target: "Strong: 2 weeks",
        steps: [
          "Realtors, property managers, home inspectors, builders, pool or fence companies.",
          "Offer to send them work, and ask them to send you theirs.",
          "Tap +1 for each one you meet.",
        ],
        scripts: ({ first, link }) => [{ label: "Text after", text: `Good to meet you. ${first} with JS Landscaping here. If any of your clients need a yard cleaned up before listing or after moving in, send them my way: ${link}` }],
      },
    ],
  },
  {
    key: "business",
    title: "Local businesses",
    blurb: "Cards in shops, partners who see homeowners",
    missions: [
      {
        key: "business-cards",
        title: "Leave cards at 10 local businesses",
        goal: 10,
        unit: "businesses",
        target: "Strong: 7 days",
        steps: [
          "Barbershops, gyms, hardware stores, nurseries, coffee shops, church boards.",
          "Start with the places you already go. Ask the owner first.",
          "Tap +1 for each place.",
        ],
        scripts: ({ first }) => [{ label: "What to say", text: `Hey, I'm ${first}. I work with JS Landscaping. Mind if I leave a few cards here for anyone who needs yard work?` }],
      },
      {
        key: "business-realtors",
        title: "Introduce yourself to 5 realtors",
        goal: 5,
        unit: "realtors",
        target: "Strong: 2 weeks",
        steps: [
          "Look for listing signs near our jobs.",
          "Call or text the agent on the sign.",
          "Tap +1 for each realtor you reach.",
        ],
        scripts: ({ first, link }) => [{ label: "Text", text: `Hi, this is ${first} with JS Landscaping. I saw your listing near one of our jobs. If any of your sellers need curb appeal before photos, we do fast cleanups and mulch. Free evaluation: ${link}` }],
      },
      {
        key: "business-swap",
        title: "Set up 2 referral swaps",
        goal: 2,
        unit: "swaps",
        target: "Strong: 2 weeks",
        steps: [
          "House cleaners, painters, roofers, pool or fence companies.",
          "Agree to send each other work.",
          "Tap +1 for each partner who agrees.",
        ],
        scripts: ({ first, link }) => [{ label: "Text", text: `Hi! ${first} with JS Landscaping. We see a lot of homeowners who also need your kind of work. Want to send each other referrals? Here's our booking link: ${link}` }],
      },
    ],
  },
  {
    key: "community",
    title: "Community",
    blurb: "Cleanups, teams, your own neighborhood",
    missions: [
      {
        key: "community-volunteer",
        title: "Volunteer at 1 cleanup day",
        goal: 1,
        unit: "cleanup",
        target: "Strong: this month",
        steps: [
          "Find a park, school or church cleanup.",
          "Wear the company shirt.",
          "Post a photo afterwards with your link. Tap +1 when it's done.",
        ],
        scripts: ({ link }) => [{ label: "Post", text: `Spent the morning helping clean up the neighborhood with JS Landscaping 🌿 Proud of this community. ${link}` }],
      },
      {
        key: "community-group",
        title: "Help out 5 times in your neighborhood group",
        goal: 5,
        unit: "helpful replies",
        target: "Strong: 2 weeks",
        steps: [
          "Answer yard questions in your neighborhood group or HOA page: when to mulch, how to edge.",
          "Be helpful first. Mention JS Landscaping only if they ask.",
          "Tap +1 for each helpful reply.",
        ],
        scripts: ({ first }) => [{ label: "Sign-off", text: `– ${first}, JS Landscaping` }],
      },
      {
        key: "community-neighbor",
        title: "Help a neighbor with something small",
        goal: 1,
        unit: "good deed",
        target: "Strong: this week",
        steps: [
          "An elderly neighbor's beds, a quick edge, a few bags of leaves.",
          "With their OK, post it on your page.",
          "Tap +1 when it's done.",
        ],
        scripts: ({ link }) => [{ label: "Post", text: `Gave my neighbor's yard a little love today 🌿 If yours needs it too: ${link}` }],
      },
    ],
  },
  {
    key: "thanks",
    title: "Thank your referrers",
    blurb: "People who send work send more when thanked",
    missions: [
      {
        key: "thanks-all",
        title: "Thank everyone who sent you work",
        goal: 3,
        unit: "thank-yous",
        target: "Strong: today",
        steps: [
          "Text or call each person who sent you a lead.",
          "Tell them when the job is done, with a photo.",
          "Tap +1 for each one.",
        ],
        scripts: ({ first }) => [{ label: "Text", text: `Hey! It's ${first}. Just wanted to say thank you for sending us your neighbor. We finished the job today and it looks great. I really appreciate it!` }],
      },
      {
        key: "thanks-public",
        title: "Thank a referrer publicly",
        goal: 1,
        unit: "post",
        target: "Strong: this week",
        steps: [
          "Ask if they're OK being tagged.",
          "Post a thank-you with the after photo and tag them.",
          "Tap +1 when it's up.",
        ],
        scripts: ({ link }) => [{ label: "Post", text: `Huge thank you for sending this job our way 🙏 Here's how it turned out. Want yours done too? ${link}` }],
      },
    ],
  },
];

export function categoryFor(key: string): MissionCategory | null {
  return MISSION_CATEGORIES.find((c) => c.key === key) ?? null;
}

export function missionFor(key: string): { category: MissionCategory; mission: Mission } | null {
  for (const category of MISSION_CATEGORIES) {
    const mission = category.missions.find((m) => m.key === key);
    if (mission) return { category, mission };
  }
  return null;
}

/**
 * The mission the board hands out: one they have not done in this category,
 * else the one they did longest ago, so a category picked twice gives
 * something new. `random` is passed in so the choice is testable.
 */
export function pickMission(categoryKey: string, done: { missionKey: string; startedAt: string }[], random: () => number = Math.random): Mission | null {
  const category = categoryFor(categoryKey);
  if (!category || category.missions.length === 0) return null;
  const doneKeys = new Set(done.map((d) => d.missionKey));
  const fresh = category.missions.filter((m) => !doneKeys.has(m.key));
  if (fresh.length > 0) return fresh[Math.floor(random() * fresh.length) % fresh.length];
  const lastDone = new Map<string, string>();
  for (const d of done) if (!lastDone.has(d.missionKey) || d.startedAt > lastDone.get(d.missionKey)!) lastDone.set(d.missionKey, d.startedAt);
  return [...category.missions].sort((a, b) => (lastDone.get(a.key) ?? "").localeCompare(lastDone.get(b.key) ?? ""))[0];
}

/** "2h 14m", "3 days 4h", "45m": how long a mission took or has been going. */
export function elapsed(fromIso: string, to: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
