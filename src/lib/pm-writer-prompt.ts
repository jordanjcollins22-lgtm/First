/**
 * What the cold email writer is told: who is writing, the story, what we
 * offer, what to lead with this season, and the rules every email keeps.
 * Pure, so the rules are tested.
 */

import { z } from "zod";

import { SEASON_ANGLE, type Season } from "@/lib/pm-outreach";

export const DEFAULT_STORY =
  "I started JS Landscaping when I was 11, cutting lawns around my neighborhood in Harford County, and I've grown it into a real local business. I'm still young, and I've put a lot of time into automating how we run: clients book online, get updates through our app, and see before and after photos of the work, so working with us takes less of your time than most contractors.";

export const DEFAULT_OFFER =
  "Snow removal and salting for the winter (we are booking contracts now), plus lawn care, leaf and seasonal cleanups, mulch and bed work, planting, trimming, weed control and soft washing.";

export const SequenceSchema = z.object({
  emails: z
    .array(
      z.object({
        step: z.number().int().min(1).max(3),
        subject: z.string(),
        body: z.string(),
      })
    )
    .length(3),
});
export type Sequence = z.infer<typeof SequenceSchema>;

export interface WriterBrief {
  businessName: string;
  sender: string;
  phone: string | null;
  story: string;
  offer: string;
  season: Season;
}

export function writerSystemPrompt(brief: WriterBrief): string {
  return [
    `You write short cold emails from ${brief.sender}, the owner of ${brief.businessName}, a landscaping and snow removal company in Harford County, Maryland, to local property management companies.`,
    "",
    "The goal of every email is one reply: a yes to a quick call, or a reply with their properties' needs. Not a sale in the email.",
    "",
    "The story, in the owner's words. Use it, in first person, briefly; never add to it:",
    brief.story,
    "",
    "What we offer:",
    brief.offer,
    "",
    "This season:",
    SEASON_ANGLE[brief.season],
    "",
    "Write a sequence of three emails:",
    "1. The first: under 110 words. Open with something specific to them (their company, their town, the kind of properties they manage, if known); one or two sentences of the story; the seasonal offer; ask one easy question they can answer in one line, such as whether they have snow covered for their properties this winter.",
    "2. Three days later, a reply in the same thread: under 70 words. A different angle: how we make their job easier (photos after every visit, one person to text, showing up when we say). Same easy question.",
    "3. A week later, the last one: under 50 words. Polite close: if snow or grounds is handled, no problem; if not, reply and we will walk a property this week at no cost.",
    "",
    "Rules:",
    "- Plain text. No links, no images, no attachments, no bullet lists in the first email. Short paragraphs.",
    "- Sign every email with the owner's first name and the business name" + (brief.phone ? `, and ${brief.phone}` : "") + ".",
    "- Subjects: short, lower case, specific, not salesy (for example \"snow at your bel air properties\"). Emails 2 and 3 use \"Re: \" and the first subject.",
    "- Never invent facts: no prices, no client names, no numbers of properties, no awards, no news features, no years in business beyond the story. Never call the business licensed, insured, certified or bonded.",
    "- No exclamation marks, no \"I hope this email finds you well\", no \"just following up\", no \"synergy\". Sound like a local owner writing one email, not a marketing team.",
    "- Do not add an unsubscribe line or a postal address: the footer is added after.",
    "",
    'Return JSON: {"emails":[{"step":1,"subject":"...","body":"..."},{"step":2,...},{"step":3,...}]}.',
  ].join("\n");
}

export function companyBrief(company: { name: string; address: string | null; website: string | null; contactName: string | null }): string {
  return [
    `Company: ${company.name}`,
    company.address ? `Address: ${company.address}` : null,
    company.website ? `Website: ${company.website}` : null,
    company.contactName ? `Write to: ${company.contactName}` : "Write to: the office (no name known; open with \"Hi there\" or the company name)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the writer must never put in a cold email, checked before anything is saved. */
export function sequenceProblems(sequence: Sequence): string[] {
  const problems: string[] = [];
  for (const email of sequence.emails) {
    const text = `${email.subject}\n${email.body}`;
    if (/https?:\/\/|www\./i.test(text)) problems.push(`Email ${email.step} has a link.`);
    if (/\b(licensed|insured|bonded|certified)\b/i.test(text)) problems.push(`Email ${email.step} claims a licence or insurance.`);
    if (/\$\s?\d/.test(text)) problems.push(`Email ${email.step} names a price.`);
    if (/featured in|as seen on|award/i.test(text)) problems.push(`Email ${email.step} claims press or awards.`);
    if (email.body.split(/\s+/).length > 160) problems.push(`Email ${email.step} is too long.`);
  }
  return problems;
}
