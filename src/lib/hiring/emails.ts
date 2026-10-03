/**
 * The emails an applicant can get, word for word. None goes by itself: each
 * is shown to the person reviewing, who can change it, and goes when they
 * press Send.
 */

export type ApplicantEmailKind = "interview" | "not_a_fit" | "video_request";

export interface ApplicantEmailInput {
  kind: ApplicantEmailKind;
  firstName: string;
  positionTitle: string;
  business: string;
  phone: string | null;
  sender: string | null;
  /** Said as it will be read: "Tue, Oct 6, 10:00 AM". Interview only. */
  when?: string | null;
  /** Where to come. Interview only; left out, the email says we'll send it. */
  place?: string | null;
  /** The video page. Video request only. */
  videoUrl?: string | null;
}

export function applicantEmail(input: ApplicantEmailInput): { subject: string; body: string } {
  const sign = [input.sender, input.business].filter(Boolean).join("\n");
  const call = input.phone ? ` If anything comes up, call or text ${input.phone}.` : "";

  if (input.kind === "interview") {
    const when = input.when ? ` on ${input.when}` : "";
    const where = input.place ? `\n\nWhere: ${input.place}` : "\n\nWe'll send you the address the day before.";
    return {
      subject: `Interview for ${input.positionTitle} with ${input.business}`,
      body:
        `Hi ${input.firstName},\n\n` +
        `Thanks for your video. We'd like to meet you in person for the ${input.positionTitle} job${when}.` +
        where +
        `\n\nPlease reply to confirm that time works.${call}\n\n` +
        `See you soon,\n${sign}`,
    };
  }

  if (input.kind === "video_request") {
    return {
      subject: `Next step for ${input.positionTitle} with ${input.business}`,
      body:
        `Hi ${input.firstName},\n\n` +
        `Thanks for applying for the ${input.positionTitle} job. The next step is a short video from your phone, about a minute, so we can meet you before an interview.\n\n` +
        `Record it here: ${input.videoUrl ?? ""}\n\n` +
        `The page tells you what to talk about.${call}\n\n` +
        `Thanks,\n${sign}`,
    };
  }

  return {
    subject: `Your application with ${input.business}`,
    body:
      `Hi ${input.firstName},\n\n` +
      `Thank you for applying for the ${input.positionTitle} job and for taking the time to send a video. ` +
      `We've decided to move forward with other applicants for now. We'll keep your application on file and reach out if something opens up that's a better fit.\n\n` +
      `We wish you the best,\n${sign}`,
  };
}

/** Where an email moves the application once it is sent. */
export function stageAfter(kind: ApplicantEmailKind): "interview" | "not_a_fit" | "video_requested" {
  return kind === "interview" ? "interview" : kind === "not_a_fit" ? "not_a_fit" : "video_requested";
}
