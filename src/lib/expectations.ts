/**
 * What the work will actually look like, and when.
 *
 * The complaint this exists to prevent is not about quality. It is about
 * time. A client looks at a photograph of a finished garden, agrees a price,
 * and then stands on their lawn two weeks later wondering why it does not
 * look like the photograph. It does not, because the photograph is of a
 * garden in its third season and theirs is in its second week. Seed germinates
 * when the soil is warm enough and not before. Sod knits down over a fortnight
 * and shows its seams the whole time. A shrub spends its first year putting
 * roots down instead of putting on growth.
 *
 * None of that is a defect and all of it is a surprise, and a surprise at the
 * end of a job is a complaint whether or not anybody did anything wrong. Said
 * at the start, in writing, beside the thing it is about, it is just how
 * planting works.
 *
 * Two rules about the wording, both learned the expensive way.
 *
 * It is specific to the work on the proposal. A paragraph of general terms
 * about the vagaries of nature gets skipped, because it is obviously boiler
 * plate and obviously written to protect us. A line that says their sod will
 * show seams for two to three weeks does not get skipped, because it is about
 * their sod.
 *
 * And it always says what they have to do. "Water it deeply twice a week for
 * the first month" is the difference between an expectation and an excuse. The
 * client who was never told to water is entitled to be annoyed when it dies;
 * the one who was told, and did, has a real claim; the one who was told and
 * did not is a conversation that ends quickly and politely.
 *
 * Matched on words rather than service ids on purpose. The proposal a client
 * reads holds a service's display label and its scope text, not its type, and
 * a business that adds a custom service called "Spring Seeding" should get the
 * seed expectations without anybody wiring it up.
 */

export interface Expectation {
  /** Short, and about their work rather than about us. */
  heading: string;
  /** What will happen, plainly. */
  body: string;
  /** How long before it looks the way they are picturing it. */
  timeframe: string;
  /** What they have to do for it to work. The half that makes it fair. */
  theirPart?: string;
  /** Words in the service name or its scope text that mean this applies. */
  matches: RegExp;
}

/**
 * Ordered as somebody reads them: the living things first, because those are
 * the ones a client is impatient about, then the surfaces, then the things
 * that come back.
 */
export const EXPECTATIONS: Expectation[] = [
  {
    heading: "New sod knits down, it does not arrive finished",
    body:
      "Fresh sod sits on the soil rather than in it, so you will see every seam between the " +
      "rolls and the colour will be uneven while it roots. Some pieces take faster than others. " +
      "Once the roots reach down into the soil underneath, the seams close and the colour evens " +
      "out on its own.",
    timeframe: "Two to three weeks to root, a full season to look established",
    theirPart:
      "Water it every day for the first two weeks, enough to keep the soil under it damp, and " +
      "keep off it as much as you can while it roots.",
    matches: /\bsod\b|\bturf\b/i,
  },
  {
    heading: "Seed comes up on the weather's schedule, not ours",
    body:
      "Grass seed germinates when the soil is warm enough and damp enough, which is usually one " +
      "to three weeks but can be longer in a cold or dry spell. The first growth is thin and " +
      "patchy and looks nothing like an established lawn. It fills in as it tillers, and a " +
      "seeded lawn generally needs two full growing seasons to thicken up properly.",
    timeframe: "One to three weeks to germinate, two seasons to thicken",
    theirPart:
      "Keep the surface damp with light watering once or twice a day until it is up, then water " +
      "less often and more deeply. Hold off mowing until it is about three inches tall.",
    matches: /\bseed|overseed|germinat|lawn restoration/i,
  },
  {
    heading: "New plants spend their first year on roots",
    body:
      "A newly planted shrub or perennial puts its energy into rooting rather than into growing, " +
      "so it will look much the same size for a while and may drop some leaves while it settles. " +
      "Beds are planted with room for the plants to reach their mature size, which means they " +
      "look sparser on the day than they will in a couple of years. Even with everything done " +
      "right, the odd plant does not take.",
    timeframe: "A season to settle, two to three years to fill in",
    theirPart:
      "Water deeply twice a week through the first growing season, more in a hot dry spell. " +
      "Tell us early if one looks to be struggling rather than after it has gone.",
    matches: /\bplant|shrub|bush|tree|perennial|install/i,
  },
  {
    heading: "Aeration looks worse before it looks better",
    body:
      "Core aeration pulls plugs of soil out and leaves them on the surface, so the lawn looks " +
      "churned up when we leave. The plugs break down in the rain and disappear, and the point " +
      "of them being there is that the compacted soil underneath can finally take water and air.",
    timeframe: "Two to three weeks for the plugs to break down",
    matches: /aerat/i,
  },
  {
    heading: "Weeds die off over days, not on the day",
    body:
      "Weed treatment works through the plant rather than on contact, so the weeds yellow, curl " +
      "and then go over a week or two. Some of the tougher ones need a second treatment, and a " +
      "lawn with heavy weed pressure is a season of work rather than one visit. New weeds will " +
      "also blow in from next door, which is nobody's fault and is why this is usually a " +
      "recurring service.",
    timeframe: "One to two weeks per treatment",
    matches: /weed control|weed treat|herbicide|weed/i,
  },
  {
    heading: "Feeding shows in the colour, gradually",
    body:
      "Fertiliser greens a lawn up over a couple of weeks rather than overnight, and how fast " +
      "depends on the temperature and the rain. A lawn that is thin because of compaction or " +
      "shade will green up and still be thin, because feeding is not the thing that was wrong " +
      "with it.",
    timeframe: "One to three weeks to show",
    matches: /fertiliz|fertilis|feed/i,
  },
  {
    heading: "Fresh mulch fades, and beds are never weed free",
    body:
      "Mulch goes on dark and weathers to a softer brown within a couple of months. That is the " +
      "colour it will be for most of the year. A good mulch layer suppresses most weeds rather " +
      "than ending them, because seeds blow in and land on top of it, and a crisp cut edge " +
      "softens over a season as the grass grows back into it.",
    timeframe: "A few months for the colour, a season for the edge",
    theirPart: "Pulling the few that do come through while they are small keeps it easy.",
    matches: /mulch|\bbed\b|\bbeds\b|rock|edge|edging/i,
  },
  {
    heading: "Hard pruning looks bare on purpose",
    body:
      "Cutting a shrub back properly means taking more off than looks comfortable, so it can " +
      "come back thick rather than woody and hollow in the middle. It will look bare or stubby " +
      "until it pushes new growth, and when that happens depends on the species and the season. " +
      "A shrub cut back in autumn stays bare until spring.",
    timeframe: "Until the next flush of growth, which can be months",
    matches: /trim|prun|cut ?back|shap/i,
  },
  {
    heading: "New soil settles after the first real rain",
    body:
      "Soil that has been moved and graded is looser than soil that has been sitting for years, " +
      "and it compacts once it gets a proper soaking. That can leave a shallow dip where there " +
      "was none on the day. It is normal, it is not a mistake, and it is easily topped up.",
    timeframe: "The first heavy rain, then it holds",
    theirPart: "Point out any low spot that appears and we will bring soil on the next visit.",
    matches: /grad|topsoil|level|fill|drainage/i,
  },
  {
    heading: "Washing lifts what is on the surface",
    body:
      "Soft washing kills and removes the algae, mildew and grime sitting on a surface. Staining " +
      "that has soaked into the material, rust, and anything that has bleached the surface " +
      "unevenly will still be there afterwards, and no pressure that is safe for the material " +
      "will shift it. Shaded and north facing surfaces grow their green back sooner than sunny " +
      "ones.",
    timeframe: "Clean on the day, regrowth in one to three years depending on shade",
    matches: /wash|clean.*surface|soft wash/i,
  },
  {
    heading: "Removals leave roots behind",
    body:
      "Taking a shrub or small tree out removes what is above ground and the root ball where we " +
      "can get to it. Roots running under a patio, a wall or a utility line stay where they are, " +
      "and a few species will send up suckers from what is left for a season or two. Grinding a " +
      "stump out is separate work and we will quote it if you want it.",
    timeframe: "Suckers for a season or two on some species",
    matches: /removal|remove|stump|dig ?out|clear/i,
  },
  {
    heading: "More leaves will fall after we go",
    body:
      "A cleanup clears what is down at the time. Trees do not finish dropping to a schedule, so " +
      "unless we are the last visit of the season there will be more leaves down within a week " +
      "or two. That is why the final cleanup of the year is usually booked late rather than " +
      "early.",
    timeframe: "Within a week or two if the trees are still dropping",
    matches: /leaf|leaves|seasonal clean|fall clean/i,
  },
];

/**
 * The ones that apply to this job.
 *
 * Matched against the service name and its scope text together, because
 * "Lawn Restoration" says nothing about seed and its scope text says
 * "seed installation". Deduplicated by heading, since three seeded areas on
 * one property is still one thing to explain.
 *
 * Order follows the list rather than the order the areas were drawn in, so
 * two proposals covering the same work read the same way.
 */
export function expectationsFor(
  areas: readonly { serviceLabel: string; scopeText?: string | null }[]
): Expectation[] {
  const text = areas
    .map((area) => `${area.serviceLabel} ${area.scopeText ?? ""}`)
    .join(" \n ");
  if (!text.trim()) return [];
  return EXPECTATIONS.filter((expectation) => expectation.matches.test(text));
}

/**
 * What an evaluator says out loud, standing on the property.
 *
 * The proposal is the record. This is the conversation, and the conversation
 * is what actually sets the expectation, because a client who has heard it
 * from a person reads the proposal as confirmation rather than as small print.
 *
 * Written as things to say rather than as rules to follow. An evaluator given
 * a policy improvises around it; one given a sentence uses the sentence.
 */
export interface BriefingPoint {
  /** What this point is for, in the evaluator's own terms. */
  heading: string;
  /** Why it matters. The reason it is worth the thirty seconds. */
  why: string;
  /** Something close to what to actually say. */
  say: string;
}

export const EVALUATOR_BRIEFING: BriefingPoint[] = [
  {
    heading: "Say it while they are happy, not when they are not",
    why:
      "Every one of these points is easy to say on the walk round and nearly impossible to say " +
      "afterwards. Said first, it is how the work goes. Said after somebody has complained, it " +
      "is an excuse, and it will be heard as one however true it is.",
    say:
      "Before we get to numbers, let me tell you what this will actually look like when we " +
      "leave, and what it looks like a month after that. They are not the same picture.",
  },
  {
    heading: "Name the gap between the photo and the day",
    why:
      "Almost everybody is picturing a finished garden from a photograph or a neighbour's " +
      "place. That garden is three seasons old. Theirs will be two weeks old. Nobody is lying " +
      "to anybody, they are just looking at different points in time.",
    say:
      "The gardens in the photos are two or three years on from the day they were planted. " +
      "Yours will get there. It will not get there in a fortnight, and I would rather tell you " +
      "that now than have you wondering in a fortnight.",
  },
  {
    heading: "Give a real number for how long",
    why:
      "\"It takes a while\" is not an expectation, it is a hedge, and a client will fill the " +
      "gap with their own number which is always shorter than ours. A range they can hold onto " +
      "stops that.",
    say:
      "Sod roots in about two to three weeks and you will see the seams the whole time. Seed is " +
      "one to three weeks to come up and two seasons to really thicken. New shrubs spend their " +
      "first year on roots before they put on much size.",
  },
  {
    heading: "Tell them their part, specifically",
    why:
      "Watering is the single biggest reason new planting fails, and it is entirely theirs to " +
      "do. A client who was never told is right to be annoyed. A client who was told, in front " +
      "of a witness, and did not, is a short and civil conversation.",
    say:
      "The one thing that decides whether this works is water, and that part is on you. Daily " +
      "for the first two weeks on sod, then deep and less often. If you are going away in that " +
      "window, tell me now and we will plan around it.",
  },
  {
    heading: "Be straight that some of it will not take",
    why:
      "Pretending a hundred percent of plants live makes the first failure feel like proof of " +
      "bad work. Saying up front that the odd one goes makes it a normal thing we will sort out " +
      "together.",
    say:
      "Planting is a living thing, so even done right, the odd one does not take. Tell me early " +
      "if something looks unhappy rather than after it has gone, and we will look at it.",
  },
  {
    heading: "Put the weather on the table before it happens",
    why:
      "A rained out Tuesday, a storm that undoes half a day of grading, a heat wave that stalls " +
      "germination. All normal, all outside anybody's control, and all much easier to discuss " +
      "in advance than on the phone the morning it happens.",
    say:
      "We work outdoors, so weather moves us. If it rains you out you keep your place at the " +
      "front of the schedule rather than going to the back. And if something real comes through, " +
      "a storm that takes down a tree or washes out fresh grading, that is extra work and we " +
      "will price it and show you before we touch it.",
  },
  {
    heading: "Never quote a date you have not got",
    why:
      "A date invented to end an awkward pause becomes the promise the whole job is judged " +
      "against, and nobody remembers it was a guess. A range with a reason attached holds up.",
    say:
      "I am not going to give you a day I cannot stand behind. What I can tell you is the " +
      "window and what would move it, and you will hear from us before it moves.",
  },
  {
    heading: "Ask them to say it back",
    why:
      "The point is not that it was said. The point is that it was understood, and the only way " +
      "to know is to hear them say it. It takes ten seconds and it is the difference between a " +
      "conversation you had and a conversation that worked.",
    say: "So what are you expecting this to look like the week after we finish?",
  },
];
