/**
 * Twelve ready-to-approve posts for the three weeks from Monday 16 November
 * 2026: four a week, one on each default best-time slot (Tue 10am, Thu 6pm,
 * Sat 9am, Sun 5pm), each for Facebook and Instagram.
 *
 * Loaded as drafts from Admin › Social (Load the starter posts). Nothing here
 * is published by loading it: each one waits for the owner's approval in
 * the week plan, and only then does the posting job send it on its slot.
 *
 * Pictures are by reference to the crew's own job photos (after photos from
 * finished jobs, by id), drawn into the post square by /api/social/card. No
 * client name or street is in any caption, only the town. Where there is no
 * photo of the thing yet (pressure washing, sealcoating, the crew), the card
 * is drawn in the brand colours and photoHint says what to shoot instead.
 *
 * {link} in a call to action becomes the post's tracked link when there is
 * one, or the booking page when there isn't.
 */

import type { CardStyle, PlanKind } from "@/lib/social-plan";
import type { SocialPlatform } from "@/lib/social/cadence";
import { zonedToUtc } from "@/lib/time-zone";

export type SeedTopic = "fall-cleanup" | "leaf-removal" | "mulch-prebook" | "pressure-washing" | "sealcoating" | "before-after" | "crew" | "local-towns";

export const SEED_TOPIC_LABEL: Record<SeedTopic, string> = {
  "fall-cleanup": "Fall cleanup",
  "leaf-removal": "Leaf removal",
  "mulch-prebook": "Spring mulch pre-book",
  "pressure-washing": "Pressure washing",
  sealcoating: "Sealcoating",
  "before-after": "Before and after",
  crew: "The crew",
  "local-towns": "Local towns",
};

export interface SeedPhoto {
  jobId: string;
  afterPhotoId: string;
  /** Town only, never the street. */
  town: string;
}

export interface SeedDraft {
  /** Stable, so loading twice is still one draft each (social_posts.seed_key). */
  key: string;
  topic: SeedTopic;
  kind: PlanKind;
  /** Local day (YYYY-MM-DD) and hour of its slot. */
  day: string;
  hour: number;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  platforms: SocialPlatform[];
  cardStyle: CardStyle;
  photo: SeedPhoto | null;
  /** What the picture is, or what to shoot when there isn't one yet. */
  photoHint: string;
}

const BOTH: SocialPlatform[] = ["facebook", "instagram"];
const PHONE = "443-819-1521";

export const SEED_DRAFTS: readonly SeedDraft[] = [
  {
    key: "2026-fall-01-fall-cleanup",
    topic: "fall-cleanup",
    kind: "openings",
    day: "2026-11-17",
    hour: 10,
    hook: "Fall cleanup spots are filling up across Harford County 🍂",
    body: "Beds cut back, leaves cleared off the lawn and out of the beds, edges cleaned up, and everything hauled away. One visit and the yard is ready to sit through winter instead of smothering under it.",
    cta: `Call or text ${PHONE} for a free estimate, or book here: {link}`,
    hashtags: ["FallCleanup", "HarfordCounty", "Fallston", "BelAirMD", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "be425ce5-69a4-415a-870a-116ce75d6419", afterPhotoId: "6710f3cd-6e95-495d-bd31-8a569a9999f5", town: "Fallston" },
    photoHint: "After photo, Zone 1, the Fallston job (1 Oct). Check it shows a finished bed before approving.",
  },
  {
    key: "2026-fall-02-leaf-removal",
    topic: "leaf-removal",
    kind: "process",
    day: "2026-11-19",
    hour: 18,
    hook: "Leaves left on the lawn all winter = bare patches in April.",
    body: "A wet mat of leaves blocks the light and holds moisture against the grass all winter, which is how you get thin, patchy spots and snow mold in spring. We blow, rake and vacuum them out of the lawn and the beds and take them away.",
    cta: `Get on the leaf removal list: call or text ${PHONE} or book at {link}`,
    hashtags: ["LeafRemoval", "LawnCare", "HarfordCounty", "ForestHillMD", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "brand",
    photo: null,
    photoHint: "Brand card. Better: a crew photo with the leaf vacuum or a tarp of leaves on any job this week.",
  },
  {
    key: "2026-fall-03-before-after-belair",
    topic: "before-after",
    kind: "before-after",
    day: "2026-11-21",
    hour: 9,
    hook: "Same yard in Bel Air. Swipe to see what changed.",
    body: "Overgrowth cut back, beds edged and cleaned out, and a fresh finish so the house stands out from the street again. This is what one visit from the crew looks like.",
    cta: `Want yours next? Free estimates: ${PHONE} or {link}`,
    hashtags: ["BeforeAndAfter", "BelAirMD", "Landscaping", "HarfordCounty", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "393710bf-0f13-42b1-8134-7f94130440dd", afterPhotoId: "c012475b-360b-4e48-b95c-a14463de8f63", town: "Bel Air" },
    photoHint: "After photo, Zone 2, the Bel Air job (1 Oct). Pick its before in the picture editor to make it a side-by-side.",
  },
  {
    key: "2026-fall-04-crew",
    topic: "crew",
    kind: "story",
    day: "2026-11-22",
    hour: 17,
    hook: "Meet the people who show up at your house.",
    body: "Same crew, every visit. Local guys from right here in Harford County who take pride in leaving every yard cleaner than they found it, and who will tell you what they did before they leave.",
    cta: `Say hi next time you see the truck, or book a visit: {link}`,
    hashtags: ["MeetTheCrew", "LocalBusiness", "HarfordCounty", "SmallBusiness", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "brand",
    photo: null,
    photoHint: "Shoot this week: the crew lined up in front of the truck, in uniform, on a finished job. Brand card until then.",
  },
  {
    key: "2026-fall-05-pressure-washing",
    topic: "pressure-washing",
    kind: "openings",
    day: "2026-11-24",
    hour: 10,
    hook: "Green on the patio or the north side of the house? That's algae, and it comes off.",
    body: "Patios, walkways, steps and siding get a slippery green film every fall. We wash it off before the holidays so the front walk looks right when the family comes over.",
    cta: `Book a pressure wash before Thanksgiving: ${PHONE} or {link}`,
    hashtags: ["PressureWashing", "PowerWashing", "BelAirMD", "AbingdonMD", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "brand",
    photo: null,
    photoHint: "No pressure washing photos in the app yet. Shoot a half-washed patio (clean stripe next to the green) on the next one.",
  },
  {
    key: "2026-fall-06-thanksgiving",
    topic: "local-towns",
    kind: "story",
    day: "2026-11-26",
    hour: 18,
    hook: "Thank you, Harford County. 🦃",
    body: "Every yard this year was a neighbor trusting us with their home. From Bel Air to Havre de Grace, Fallston to Edgewood: thank you for letting a local crew do the work. Enjoy the day with your people.",
    cta: `Happy Thanksgiving from all of us. {link}`,
    hashtags: ["Thanksgiving", "HarfordCounty", "ShopLocal", "Grateful", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "brand",
    photo: null,
    photoHint: "Brand card. A crew group photo works here too.",
  },
  {
    key: "2026-fall-07-local-towns",
    topic: "local-towns",
    kind: "local",
    day: "2026-11-28",
    hour: 9,
    hook: "Abingdon, Bel Air, Forest Hill, Fallston: we're in your neighborhood this week.",
    body: "The crew is already working in your area, which means less drive time and a sooner date for you. Fall cleanups, leaf removal and bed cleanouts, booked by the street.",
    cta: `Grab a spot while we're nearby: ${PHONE} or {link}`,
    hashtags: ["AbingdonMD", "BelAirMD", "ForestHillMD", "FallstonMD", "HarfordCounty"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "cc665f8c-b17c-49f5-bb6b-0e3212ffcd35", afterPhotoId: "b5b4faa0-4172-4bcd-8358-067191845a3b", town: "Abingdon" },
    photoHint: "After photo, Zone 1, the Abingdon job (1 Oct).",
  },
  {
    key: "2026-fall-08-mulch-prebook",
    topic: "mulch-prebook",
    kind: "openings",
    day: "2026-11-29",
    hour: 17,
    hook: "Spring mulch, booked now. Skip the April wait.",
    body: "Every spring the mulch list fills up in a couple of weeks. Pre-book now and your beds are on the first round in March or April: edged, weeded and finished with fresh mulch before the neighbors have called anyone.",
    cta: `Get on the spring mulch list: ${PHONE} or {link}`,
    hashtags: ["Mulch", "SpringMulch", "HarfordCounty", "AbingdonMD", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "c494d1e6-8af7-4f34-bc82-0400c1d45c5e", afterPhotoId: "1f20cea1-bba3-4076-a55f-94d090e44aef", town: "Abingdon" },
    photoHint: "After photo, Zone 1, the Abingdon mulching job (27 Aug): fresh mulch.",
  },
  {
    key: "2026-fall-09-sealcoating",
    topic: "sealcoating",
    kind: "process",
    day: "2026-12-01",
    hour: 10,
    hook: "Why your driveway cracks every winter (and how sealcoating stops it).",
    body: "Water gets into small cracks, freezes, expands and breaks the asphalt a little more every cold snap. Sealcoat fills the surface and keeps water and salt out. It goes down when it's warm, so we're booking the first warm weeks of spring now.",
    cta: `Reserve a spring sealcoat: ${PHONE} or {link}`,
    hashtags: ["Sealcoating", "Driveway", "HarfordCounty", "BelAirMD", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "brand",
    photo: null,
    photoHint: "No sealcoating photos in the app yet. Brand card; next spring, shoot a fresh black driveway from the street.",
  },
  {
    key: "2026-fall-10-before-after-belcamp",
    topic: "before-after",
    kind: "before-after",
    day: "2026-12-03",
    hour: 18,
    hook: "This Belcamp yard needed a reset. Here's the after.",
    body: "Overgrown beds, weeds through the edges and shrubs into the windows. The crew cut it all back, cleaned the beds out and gave it clean lines again in a single visit.",
    cta: `Free estimates in Belcamp, Aberdeen and Havre de Grace: ${PHONE} or {link}`,
    hashtags: ["BeforeAndAfter", "BelcampMD", "AberdeenMD", "HarfordCounty", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "8cfe2f7e-266a-4556-9d82-53715a702dd6", afterPhotoId: "094278e6-6b07-4bc8-a824-b40ac8da9f09", town: "Belcamp" },
    photoHint: "After photo, Zone 1, the Belcamp job (9 Sep). Pick its before in the picture editor for a side-by-side.",
  },
  {
    key: "2026-fall-11-last-leaves",
    topic: "leaf-removal",
    kind: "openings",
    day: "2026-12-05",
    hour: 9,
    hook: "Last leaf pickups of the year are going on the schedule now.",
    body: "The oaks drop last, and they drop a lot. One final pass clears the lawn, the beds and the gutters' worth of leaves along the foundation so nothing sits wet against the house all winter.",
    cta: `Get the final pass booked: ${PHONE} or {link}`,
    hashtags: ["LeafRemoval", "FallCleanup", "AbingdonMD", "EdgewoodMD", "JSLandscaping"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "63c1d4be-03b3-4eb2-bf5f-00006afecd6f", afterPhotoId: "164b1643-2be2-4340-965e-1f0106b8a5ba", town: "Abingdon" },
    photoHint: "After photo, Zone 1, the Abingdon job (16 Sep).",
  },
  {
    key: "2026-fall-12-mulch-local",
    topic: "mulch-prebook",
    kind: "local",
    day: "2026-12-06",
    hour: 17,
    hook: "Havre de Grace, Edgewood, Jarrettsville: the spring mulch list is open.",
    body: "We're putting next spring's routes together now, town by town. Neighbors on the same route get the earliest dates, so if the people on your street are already on the list, you'll go out with them.",
    cta: `Add your house to the spring list: ${PHONE} or {link}`,
    hashtags: ["HavreDeGrace", "EdgewoodMD", "JarrettsvilleMD", "SpringMulch", "HarfordCounty"],
    platforms: BOTH,
    cardStyle: "photo",
    photo: { jobId: "df412fb2-174c-4682-b546-e5382d895d39", afterPhotoId: "127709e3-b229-48f9-b8ed-f5748941d313", town: "Bel Air" },
    photoHint: "After photo, Zone 2, a Bel Air job (19 Aug).",
  },
];

/** When a seed's slot is, as an instant. */
export function seedSlot(seed: Pick<SeedDraft, "day" | "hour">): Date {
  return zonedToUtc(seed.day, `${String(seed.hour).padStart(2, "0")}:00`);
}

/** The call to action with the link filled in. */
export function seedCta(seed: Pick<SeedDraft, "cta">, link: string): string {
  return seed.cta.replace(/\{link\}/g, link);
}
