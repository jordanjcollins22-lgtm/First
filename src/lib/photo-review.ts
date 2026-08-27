/**
 * The manager's look at the finished work, before the client sees it.
 *
 * The crew sign off from site. Nobody senior has been back, and the first
 * person to notice the bed that was never re-edged is the customer standing
 * next to the account manager on a walkthrough. This is the step in between:
 * the after photos go to the account manager, who either marks what still
 * needs doing or says it is right.
 *
 * A mark is a pin plus an instruction. A pin on its own is somebody pointing
 * at a photograph, which the crew cannot act on.
 */

export type ReviewStatus = "not_ready" | "awaiting_review" | "changes_requested" | "approved";

export interface PhotoMark {
  id: string;
  photoId: string;
  /** Fractions of the image, 0-1, so a pin lands in the same place on every
   * screen without anybody recomputing it. */
  x: number;
  y: number;
  /** What is wrong and what to do about it. Never empty — see markIsUsable. */
  note: string;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
}

/**
 * A mark the crew can act on.
 *
 * The whole value of this step is the sentence, not the pin. A pin with
 * nothing written on it sends somebody back to a garden to look at a
 * photograph and guess.
 */
export function markIsUsable(note: string): boolean {
  return note.trim().length > 0;
}

/** Marks still outstanding, oldest first — the punch list. */
export function openMarks(marks: PhotoMark[]): PhotoMark[] {
  return marks
    .filter((mark) => mark.resolvedAt == null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function marksOnPhoto(marks: PhotoMark[], photoId: string): PhotoMark[] {
  return openMarks(marks).filter((mark) => mark.photoId === photoId);
}

/**
 * Where the review has got to.
 *
 * Outstanding marks beat an approval that predates them: a manager who
 * approved on Tuesday and marked something on Wednesday has not approved
 * what they marked. The punch list wins until it is empty.
 */
export function reviewStatus(input: {
  crewSignedOff: boolean;
  marks: PhotoMark[];
  approvedAt: string | null;
}): ReviewStatus {
  if (!input.crewSignedOff) return "not_ready";

  const outstanding = openMarks(input.marks);
  if (outstanding.length > 0) return "changes_requested";

  if (input.approvedAt == null) return "awaiting_review";

  // An approval only covers what existed when it was given.
  const newest = input.marks.reduce<string | null>(
    (latest, mark) => (latest == null || mark.createdAt > latest ? mark.createdAt : latest),
    null
  );
  if (newest != null && newest > input.approvedAt) return "awaiting_review";

  return "approved";
}

/** Whether the manager can sign the photos off right now. */
export function canApprove(marks: PhotoMark[]): boolean {
  return openMarks(marks).length === 0;
}

/**
 * Whether it is time to get the client out.
 *
 * Only once the photos are approved. Booking a walkthrough over work that
 * still has a punch list on it is how a customer gets shown the one bed
 * nobody finished.
 */
export function readyForWalkthrough(status: ReviewStatus): boolean {
  return status === "approved";
}

export function describeStatus(status: ReviewStatus): string {
  switch (status) {
    case "not_ready":
      return "The crew haven't signed off yet.";
    case "awaiting_review":
      return "Waiting on you to check the photos.";
    case "changes_requested":
      return "Sent back to the crew with a punch list.";
    case "approved":
      return "Photos approved — book the walkthrough.";
  }
}

/** One line for a list: what is outstanding, or that nothing is. */
export function summarise(marks: PhotoMark[]): string {
  const open = openMarks(marks);
  if (open.length === 0) return "Nothing outstanding";
  return open.length === 1 ? "1 touch-up" : `${open.length} touch-ups`;
}
