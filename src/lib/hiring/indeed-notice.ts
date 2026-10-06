/**
 * Reading Indeed's "someone applied" email, so the applicant can be sent our
 * own application link without anybody typing it.
 *
 * Indeed hides an applicant's real address behind one at indeedemail.com:
 * mail to it reaches them through Indeed's messages. Indeed sends each
 * application from that address ("conversation-...@indeedemail.com", subject
 * "[Action required] New application for <job>"); older emails came from
 * indeed.com with it as the reply-to or in the body. Either way it is found. The job
 * is in the subject or body by its Indeed title, which is the title our
 * positions use. The daily round-up ("5 new applicants across 3 jobs") names
 * several people and gives no address, so it is not one of these.
 *
 * Pure, so it is tested on real-shaped mail.
 */

import { POSITIONS, type PositionKey } from "@/lib/hiring/positions";

export interface IndeedMail {
  from: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  /** Reply-to as the provider gives it: one address, a list, or none. */
  replyTo?: string | string[] | null;
}

export interface IndeedNotice {
  /** Their full name when the email gives it. */
  name: string | null;
  position: PositionKey;
  /** The indeedemail.com address that reaches them, when there is one. */
  relay: string | null;
}

const RELAY = /[a-z0-9._%+-]+@indeedemail\.com/gi;

/** An address on Indeed's own domain, or one of its relay addresses for an applicant. */
export function isIndeedAddress(address: string): boolean {
  return /@([a-z0-9-]+\.)*(indeed|indeedemail)\.com$/i.test(address.trim());
}

/** The relay address the email was sent from, when an applicant's Indeed conversation sent it. */
export function relaySender(from: string): string | null {
  const found = from.match(RELAY);
  return found ? found[0].toLowerCase() : null;
}

/** Whether the email came from Indeed at all, sent straight or forwarded on. */
export function isFromIndeed(mail: IndeedMail): boolean {
  const from = mail.from.toLowerCase();
  if (/@([a-z0-9-]+\.)*(indeed|indeedemail)\.com\b/.test(from)) return true;
  // Forwarded by hand: from the owner, with Indeed's own message inside.
  return /^\s*(fwd?|fw):/i.test(mail.subject ?? "") && /indeed/i.test(`${mail.text ?? ""}${mail.html ?? ""}`);
}

/** Whether it is the round-up of several applicants rather than one application. */
export function isRoundUp(subject: string): boolean {
  return /debrief|digest|new applicants across|candidates? (today|this week)|daily|weekly|summary/i.test(subject);
}

/** The position an Indeed job title names: the full title first, then its telling word. */
export function positionIn(text: string): PositionKey | null {
  const lower = text.toLowerCase();
  const byTitle = [...POSITIONS].sort((a, b) => b.title.length - a.title.length).find((p) => lower.includes(p.title.toLowerCase()));
  if (byTitle) return byTitle.key;
  if (/project lead|crew lead|foreman/.test(lower)) return "project-lead";
  if (/technician|landscap(e|ing) (crew|laborer|worker)/.test(lower)) return "project-technician";
  if (/evaluator/.test(lower)) return "evaluator";
  if (/account manager/.test(lower)) return "account-manager";
  if (/affiliate/.test(lower)) return "affiliate";
  return null;
}

const NAME = "([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){0,3})";
const SUBJECT_NAMES = [
  // "New application: Landscape Project Technician - Daniel Jay"
  new RegExp(`application[^:]*:\\s*.+?\\s[-–—]\\s${NAME}\\s*$`, "i"),
  // "Daniel Jay applied to Landscape Project Technician"
  new RegExp(`^${NAME} (?:has )?applied\\b`),
  // "New candidate for Landscape Project Technician: Daniel Jay"
  new RegExp(`candidate[^:]*:\\s*${NAME}\\s*$`, "i"),
];

const BODY_NAMES = [
  // "Daniel Jay applied to your job" / "Daniel Jay has applied for"
  new RegExp(`(?:^|\\n)[ \\t]*${NAME} (?:has |just )?applied\\b`),
  // "You have a new application from Daniel Jay"
  new RegExp(`application from ${NAME}\\b`),
];

/** Their name, from the subject when it says it, as Indeed writes it. */
export function nameIn(subject: string): string | null {
  const clean = subject.replace(/^\s*((fwd?|fw|re):\s*|\[[^\]]*\]\s*)+/i, "").trim();
  for (const pattern of SUBJECT_NAMES) {
    const match = clean.match(pattern);
    if (match) return tidyName(match[1]);
  }
  return null;
}

/** Their name from the body, for the emails whose subject only names the job. */
export function nameInBody(text: string): string | null {
  for (const pattern of BODY_NAMES) {
    const match = text.match(pattern);
    if (match && !/^(indeed|someone|a candidate|you)\b/i.test(match[1])) return tidyName(match[1]);
  }
  return null;
}

/** "RUDOLPH JONES" reads as "Rudolph Jones"; "Savannah DiNunzio" stays as it is. */
export function tidyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : trimmed;
}

/** The address that reaches them: the reply-to first, then any in the body. */
export function relayIn(mail: IndeedMail): string | null {
  const sender = relaySender(mail.from);
  if (sender) return sender;
  const replyTo = Array.isArray(mail.replyTo) ? mail.replyTo.join(" ") : (mail.replyTo ?? "");
  const found = `${replyTo} ${mail.text ?? ""} ${mail.html ?? ""}`.match(RELAY);
  return found ? found[0].toLowerCase() : null;
}

/**
 * One applicant out of Indeed's application email, or null when it is not
 * one (another Indeed email, the daily round-up, or a job we don't have).
 */
export function readIndeedNotice(mail: IndeedMail): IndeedNotice | null {
  if (!isFromIndeed(mail)) return null;
  const subject = mail.subject ?? "";
  if (isRoundUp(subject)) return null;
  // A reply in an applicant's conversation (to our own invite, say) is them
  // talking to us, not a new application.
  if (/^\s*(re|fwd?|fw)\s*:/i.test(subject) && relaySender(mail.from)) return null;
  const relay = relayIn(mail);
  const looksLikeApplication = relaySender(mail.from)
    ? /new application|applied|new candidate/i.test(subject)
    : /appl(y|ied|ication)|candidate/i.test(subject);
  if (!looksLikeApplication && !relay) return null;
  if (!looksLikeApplication && relaySender(mail.from)) return null;
  const body = `${mail.text ?? ""} ${mail.html ?? ""}`;
  const position = positionIn(subject) ?? positionIn(body);
  if (!position) return null;
  const plain = mail.text ?? (mail.html ?? "").replace(/<[^>]+>/g, "\n");
  return { name: nameIn(subject) ?? nameInBody(plain), position, relay };
}

/** The first name to greet them by, or "there" when the email didn't say. */
export function greetingName(name: string | null): string {
  return name?.split(" ")[0] || "there";
}

/** The email that sends them to our application, word for word as approved. */
export function applyInvite(input: { name: string | null; positionTitle: string; applyUrl: string; sender: string; business: string }): {
  subject: string;
  text: string;
} {
  return {
    subject: `Next step for your application – ${input.business}`,
    text:
      `Hi ${greetingName(input.name)},\n\n` +
      `Thanks for applying for the ${input.positionTitle} job on Indeed. To keep your application moving, please complete our short application here:\n\n` +
      `${input.applyUrl}\n\n` +
      `It's a few quick questions. If you're a fit, the next step is a short video answering one question, recorded on your phone. ` +
      `I watch every video myself and then invite people in for an in-person interview.\n\n` +
      `Thanks,\n${input.sender}\n${input.business}`,
  };
}
