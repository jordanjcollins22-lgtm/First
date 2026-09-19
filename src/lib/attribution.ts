/**
 * Where the work came from, and where it honestly did not come from.
 *
 * The chain the business wants is campaign → lead → evaluation → proposal →
 * job → revenue, and the only way to have it is to write down what was known
 * at the time. Most of it is written down. Some of it is not, and this file is
 * mostly about that part.
 *
 * There are two different ways a link can be missing, and collapsing them is
 * the single most common way an attribution report becomes a lie:
 *
 * **Unattributed** means nothing was ever recorded and nothing reached this
 * address. There is no answer because there was never a question. A hundred
 * unattributed jobs is a recording problem, and it is fixable.
 *
 * **Unknown** means we looked and the answer genuinely cannot be determined --
 * three waves went through that street in the six weeks before the call, and
 * any of them could have been the one. A hundred unknown jobs is not a
 * recording problem; it is what happens when campaigns overlap, and the fix is
 * to stop overlapping them, not to pick one.
 *
 * Neither is ever folded into "other", and neither is ever resolved by picking
 * the most likely candidate. A guessed attribution is worse than a missing
 * one, because somebody will spend money on it.
 *
 * There is no model here. A link is either recorded, or inferred by a rule
 * written out below in a sentence, or it is one of the two honest absences.
 */

export const CHANNELS = [
  "door_hanger",
  "eddm",
  "flyer",
  "referral",
  "repeat",
  "inbound",
  "other_campaign",
] as const;

export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  door_hanger: "Door hangers",
  eddm: "EDDM mailings",
  flyer: "Flyers",
  referral: "Referrals",
  repeat: "Repeat clients",
  inbound: "Came to us",
  other_campaign: "Other campaigns",
};

/**
 * How sure the link is, and it is part of the answer rather than a footnote.
 *
 * A report that shows recorded and inferred revenue in the same bar is a
 * report that will be used to move a budget on the strength of a guess.
 */
export type Confidence = "recorded" | "inferred" | "unknown" | "unattributed";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  recorded: "Recorded at the time",
  inferred: "Worked out from one campaign in range",
  unknown: "Could not be told apart",
  unattributed: "Nothing recorded, nothing reached them",
};

export interface Attribution {
  /** Null for both honest absences: there is no channel to name. */
  channel: Channel | null;
  confidence: Confidence;
  /** The campaign, when one is named. */
  waveId: string | null;
  /** One sentence somebody can check. Always present, including for absences. */
  because: string;
}

export interface JobAttributionFacts {
  jobId: string;
  /** Recorded on the job when it was created. */
  sourceWaveId: string | null;
  sourceWaveChannel: Channel | null;
  /** Somebody on the team is named as having referred it. */
  referredByProfileId: string | null;
  /** The client had finished work with us before this job was sold. */
  hadEarlierCompletedJob: boolean;
  /** They booked themselves, through a link we published. */
  cameThroughBookingLink: boolean;
  /**
   * Campaigns that reached this address in the window before the lead, newest
   * first. Empty means nothing reached them, which is a different thing from
   * not knowing.
   */
  campaignsInRange: { waveId: string; channel: Channel; deliveredAt: string; label: string }[];
  /** Whether the address is on the map at all. Off the map, nothing can be in range. */
  addressOnMap: boolean;
}

/** How long after a campaign a job may still be credited to it. */
export const CREDIT_WINDOW_DAYS = 60;

/**
 * What brought this job in.
 *
 * The order is the order of certainty, not of importance: anything actually
 * recorded beats anything worked out, and the only thing worked out is the
 * case where exactly one campaign could possibly have done it.
 */
export function attribute(facts: JobAttributionFacts): Attribution {
  if (facts.sourceWaveId && facts.sourceWaveChannel) {
    return {
      channel: facts.sourceWaveChannel,
      confidence: "recorded",
      waveId: facts.sourceWaveId,
      because: "The campaign was recorded on the job when it was created.",
    };
  }

  if (facts.referredByProfileId) {
    return {
      channel: "referral",
      confidence: "recorded",
      waveId: null,
      because: "Somebody on the team is named as having referred it.",
    };
  }

  if (facts.hadEarlierCompletedJob) {
    return {
      channel: "repeat",
      confidence: "recorded",
      waveId: null,
      because: "This client had finished work with us before this job was sold.",
    };
  }

  if (facts.cameThroughBookingLink) {
    return {
      channel: "inbound",
      confidence: "recorded",
      waveId: null,
      because: "They booked themselves through a link we published.",
    };
  }

  // Exactly one campaign could have done it. This is the only inference in the
  // file, and it is stated on the row rather than blended into the total.
  if (facts.campaignsInRange.length === 1) {
    const only = facts.campaignsInRange[0];
    return {
      channel: only.channel,
      confidence: "inferred",
      waveId: only.waveId,
      because: `${only.label} was the only campaign to reach this address in the ${CREDIT_WINDOW_DAYS} days before.`,
    };
  }

  if (facts.campaignsInRange.length > 1) {
    return {
      channel: null,
      confidence: "unknown",
      waveId: null,
      because: `${facts.campaignsInRange.length} campaigns reached this address in the ${CREDIT_WINDOW_DAYS} days before, and nothing recorded which one worked.`,
    };
  }

  return {
    channel: null,
    confidence: "unattributed",
    waveId: null,
    because: facts.addressOnMap
      ? "No campaign reached this address, and no source was recorded."
      : "This address is not on the map, so nothing could be checked, and no source was recorded.",
  };
}

export interface ChannelTotal {
  channel: Channel;
  /** Money actually received, net of refunds and chargebacks. */
  revenueCents: number;
  jobs: number;
  /** Of those, how many rest on the one inference rule. */
  inferredJobs: number;
  inferredRevenueCents: number;
}

export interface AttributionTotals {
  channels: ChannelTotal[];
  /** Looked at, could not be told apart. */
  unknown: { jobs: number; revenueCents: number };
  /** Nothing recorded and nothing reached them. */
  unattributed: { jobs: number; revenueCents: number };
  totalJobs: number;
  totalRevenueCents: number;
}

/**
 * The totals, with the two absences kept out of the channels entirely.
 *
 * They are returned beside the channels rather than as two more bars, because
 * a bar labelled "Unknown" next to a bar labelled "Door hangers" invites
 * somebody to compare them, and they are not the same kind of thing: one is a
 * result and the other is the absence of one.
 */
export function totalsByChannel(
  rows: readonly { attribution: Attribution; revenueCents: number }[]
): AttributionTotals {
  const byChannel = new Map<Channel, ChannelTotal>();
  const unknown = { jobs: 0, revenueCents: 0 };
  const unattributed = { jobs: 0, revenueCents: 0 };

  for (const row of rows) {
    const { channel, confidence } = row.attribution;
    if (confidence === "unknown") {
      unknown.jobs += 1;
      unknown.revenueCents += row.revenueCents;
      continue;
    }
    if (confidence === "unattributed" || channel == null) {
      unattributed.jobs += 1;
      unattributed.revenueCents += row.revenueCents;
      continue;
    }
    const held = byChannel.get(channel) ?? {
      channel,
      revenueCents: 0,
      jobs: 0,
      inferredJobs: 0,
      inferredRevenueCents: 0,
    };
    held.jobs += 1;
    held.revenueCents += row.revenueCents;
    if (confidence === "inferred") {
      held.inferredJobs += 1;
      held.inferredRevenueCents += row.revenueCents;
    }
    byChannel.set(channel, held);
  }

  return {
    channels: [...byChannel.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    unknown,
    unattributed,
    totalJobs: rows.length,
    totalRevenueCents: rows.reduce((sum, r) => sum + r.revenueCents, 0),
  };
}

/**
 * What the report can and cannot support, said before somebody acts on it.
 *
 * Returns the sentences worth putting above the numbers. An empty list means
 * the attribution is good enough to spend money on, which is a claim worth
 * being able to make and worth not making lightly.
 */
export function healthOf(totals: AttributionTotals): string[] {
  const notes: string[] = [];
  if (totals.totalJobs === 0) return ["No sold work in this period."];

  const unattributedShare = totals.unattributed.jobs / totals.totalJobs;
  if (unattributedShare >= 0.3) {
    notes.push(
      `${Math.round(unattributedShare * 100)}% of jobs have no source recorded and no campaign near them. That is a recording problem, and it is fixable: ask on the call.`
    );
  }

  const unknownShare = totals.unknown.jobs / totals.totalJobs;
  if (unknownShare >= 0.2) {
    notes.push(
      `${Math.round(unknownShare * 100)}% could not be told apart because campaigns overlapped. Staggering them would make the next quarter readable.`
    );
  }

  const inferred = totals.channels.reduce((sum, c) => sum + c.inferredJobs, 0);
  if (inferred > 0 && inferred / totals.totalJobs >= 0.25) {
    notes.push(
      `${Math.round((inferred / totals.totalJobs) * 100)}% rests on one campaign having been the only one in range, rather than on anything recorded.`
    );
  }

  return notes;
}

/**
 * Cost per job won, where the cost is known.
 *
 * Null rather than a number when the campaign's spend was never recorded: a
 * cost per job computed from a zero cost reads as a spectacular success.
 */
export function costPerJob(spendCents: number | null, jobs: number): number | null {
  if (spendCents == null || jobs <= 0) return null;
  return Math.round(spendCents / jobs);
}
