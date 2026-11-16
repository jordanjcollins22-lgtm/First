/**
 * The emails an applicant can get, word for word. Each one the reviewer
 * starts is shown to them first, can be changed, and goes when they press
 * Send. The welcome is the one exception: it goes by itself the moment
 * someone replies "I accept" to their offer.
 */

export type ApplicantEmailKind = "interview" | "not_a_fit" | "video_request" | "offer" | "skills_question";

/** How long an offer stays open, in hours. */
export const OFFER_OPEN_HOURS = 48;

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
  /** The skills question page and the question. Skills question only. */
  skillsUrl?: string | null;
  skillsQuestion?: string | null;
  /** Interviews by phone or video call, not in person. */
  remote?: boolean;
  /** The pay, as the careers page says it. Offer only. */
  pay?: string | null;
  /** Which job, for what the first days look like. Offer only. */
  positionKey?: string | null;
}

/** What they bring, and what we give them, by job. Only crew jobs need gear. */
function gearFor(positionKey: string | null | undefined): string | null {
  if (positionKey === "project-technician") {
    return "We provide a crew hoodie, gloves, and eye and ear protection. You bring work boots and clothes for the weather.";
  }
  return null;
}

/** The first days, by job, so the offer says what they're agreeing to. */
function firstDaysFor(positionKey: string | null | undefined): string {
  if (positionKey === "project-technician") {
    return "Your first 30 days: in-field training with a trainer on a real crew, signing off each skill. Days start at the shop at 6:50 AM.";
  }
  if (positionKey === "account-manager") {
    return "Your first 30 days: learn our app, scheduling, invoicing and the free satellite estimates, and shadow paid site visits.";
  }
  if (positionKey === "affiliate") {
    return "Your first week: get your own referral link and learn the services we offer, so you can tell people what we do.";
  }
  return "Your first 30 days: training on how we work, with check-ins along the way.";
}

export function applicantEmail(input: ApplicantEmailInput): { subject: string; body: string } {
  const sign = [input.sender, input.business].filter(Boolean).join("\n");
  const call = input.phone ? ` If anything comes up, call or text ${input.phone}.` : "";

  if (input.kind === "interview") {
    const when = input.when ? ` on ${input.when}` : "";
    const where = input.remote
      ? input.place
        ? `\n\nJoin here: ${input.place}`
        : "\n\nWe'll call you at the number you gave us."
      : input.place
        ? `\n\nWhere: ${input.place}`
        : "\n\nWe'll send you the address the day before.";
    const meet = input.remote ? "talk with you on a quick phone or video call" : "meet you in person";
    return {
      subject: `Interview for ${input.positionTitle} with ${input.business}`,
      body:
        `Hi ${input.firstName},\n\n` +
        `Thanks for your video. We'd like to ${meet} for the ${input.positionTitle} job${when}.` +
        where +
        `\n\nPlease reply to confirm that time works.${call}\n\n` +
        `See you soon,\n${sign}`,
    };
  }

  if (input.kind === "offer") {
    const gear = gearFor(input.positionKey);
    return {
      subject: `Your offer for ${input.positionTitle} with ${input.business}`,
      body:
        `Hi ${input.firstName},\n\n` +
        `Congratulations! We'd like to offer you the ${input.positionTitle} job.\n\n` +
        (input.pay ? `Pay: ${input.pay}.\n\n` : "") +
        `${firstDaysFor(input.positionKey)}\n\n` +
        (gear ? `${gear}\n\n` : "") +
        `To accept, just reply to this email with "I accept". This offer is open for ${OFFER_OPEN_HOURS} hours, and you can start within a week of saying yes.${call}\n\n` +
        `We're glad you're joining us,\n${sign}`,
    };
  }

  if (input.kind === "skills_question") {
    return {
      subject: `One question for the ${input.positionTitle} job with ${input.business}`,
      body:
        `Hi ${input.firstName},\n\n` +
        `Thanks for talking with us. The next step is one quick question you answer from your phone, in writing or with a recording. It takes about five minutes.\n\n` +
        `The question: ${input.skillsQuestion ?? ""}\n\n` +
        `Answer it here: ${input.skillsUrl ?? ""}\n\n` +
        `Answer the way you really would. There's no wrong way to say it.${call}\n\n` +
        `Thanks,\n${sign}`,
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
export function stageAfter(kind: ApplicantEmailKind): "interview" | "not_a_fit" | "video_requested" | "offer_sent" | "working_interview" {
  if (kind === "interview") return "interview";
  if (kind === "skills_question") return "working_interview";
  if (kind === "not_a_fit") return "not_a_fit";
  if (kind === "offer") return "offer_sent";
  return "video_requested";
}

/**
 * Whether a reply to the offer says yes. It has to say "I accept" in so many
 * words, and not alongside a "not" or a question, so "I accept, but can I
 * start in a month?" waits for a person.
 */
export function isAcceptance(reply: string): boolean {
  const text = reply.replace(/\s+/g, " ").trim().toLowerCase();
  if (!/\bi (do )?(accept|happily accept|gladly accept)\b/.test(text)) return false;
  if (/\b(don'?t|do not|can'?t|cannot|won'?t|not)\s+accept/.test(text)) return false;
  if (/\bbut\b|\?/.test(text)) return false;
  return true;
}

/** The welcome, sent by itself when they accept: what happens before and on day one. */
export function welcomeEmail(input: { firstName: string; positionTitle: string; positionKey: string | null; business: string; phone: string | null; sender: string | null }): {
  subject: string;
  body: string;
} {
  const sign = [input.sender, input.business].filter(Boolean).join("\n");
  const call = input.phone ? `Questions before then? Call or text ${input.phone}.\n\n` : "";
  const crew = input.positionKey === "project-technician";
  const before = [
    "Fill in your new-hire paperwork (we'll send the forms to sign on your phone).",
    ...(crew ? ["Get work boots, and clothes for the weather."] : []),
    "Watch for a text from us with how to get into our app.",
  ];
  const dayOne = crew
    ? [
        "Be at the shop at 6:50 AM.",
        "Meet the crew and your trainer, get your gear, and do the safety walk.",
        "Then a real job with your trainer, who stays with you all week.",
      ]
    : ["We'll meet, set you up in the app, and go through your first week together."];
  return {
    subject: `Welcome to ${input.business}`,
    body:
      `Hi ${input.firstName},\n\n` +
      `Welcome aboard! We're excited to have you as our new ${input.positionTitle}.\n\n` +
      `Before day one:\n${before.map((b) => `- ${b}`).join("\n")}\n\n` +
      `Day one:\n${dayOne.map((b) => `- ${b}`).join("\n")}\n\n` +
      `${call}` +
      `See you soon,\n${sign}`,
  };
}
