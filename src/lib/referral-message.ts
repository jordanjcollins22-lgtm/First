/**
 * The message an affiliate sends someone they know, with their own tracked
 * link in it. Written to sound like a person, fitting how they know them,
 * and true: it points them to the instant estimate, never promising it's free.
 */

export const AFFILIATIONS = [
  { key: "neighbor", label: "Neighbor" },
  { key: "friend", label: "Friend" },
  { key: "family", label: "Family" },
  { key: "coworker", label: "Coworker" },
  { key: "online_message", label: "Messaged me online" },
  { key: "online_post", label: "Posted asking for help" },
  { key: "other", label: "Other" },
] as const;

export type Affiliation = (typeof AFFILIATIONS)[number]["key"];

/** Older choices that are no longer offered but are still on sent rows. "Someone online" meant a post. */
const RETIRED: Record<string, Affiliation> = { online: "online_post", "Someone online": "online_post" };

export function isAffiliation(value: string): value is Affiliation {
  return AFFILIATIONS.some((a) => a.key === value);
}

/** The choice a sent row was made with, from its saved key or label. */
export function affiliationOf(value: string | null | undefined): Affiliation {
  if (!value) return "other";
  return AFFILIATIONS.find((a) => a.key === value || a.label === value)?.key ?? RETIRED[value] ?? "other";
}

export function affiliationLabel(key: string | null | undefined): string {
  const found = AFFILIATIONS.find((a) => a.key === key || a.label === key);
  if (found) return found.label;
  return key === "Someone online" || key === "online" ? "Someone online" : "Other";
}

/** Their first name, tidied: what goes after "Hey". */
export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1) : "";
}

/** The sender's position, so the message says who they are to the business. */
export type SenderRole = "owner" | "account-manager" | "technician" | "affiliate";

/** Their highest position, from the app's role list. */
export function senderRoleOf(roles: readonly string[]): SenderRole {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("account-manager")) return "account-manager";
  if (roles.includes("project-lead") || roles.includes("project-technician")) return "technician";
  return "affiliate";
}

/** "I'm the owner of …", "I work with …": who the sender is, by their position. */
export function whoIAm(role: SenderRole | null | undefined, business: string): string {
  switch (role) {
    case "owner":
      return `I'm the owner of ${business}`;
    case "account-manager":
      return `I'm an account manager at ${business}`;
    case "technician":
      return `I'm a technician with ${business}`;
    default:
      return `I work with ${business}`;
  }
}

/**
 * Laid out like a text from a person: the greeting on its own line, a blank
 * line between parts, and their link on a line of its own so it stays tappable.
 * A post gets a comment under it, so that one answers the post directly rather
 * than saying it was seen.
 */
export function referralMessage(input: { name: string; affiliation: Affiliation; link: string; business: string; from: string | null; role?: SenderRole | null }): string {
  const them = firstNameOf(input.name);
  const me = input.from ? firstNameOf(input.from) : null;
  const online = input.affiliation === "online_message" || input.affiliation === "online_post";
  const hi = online ? `Hi ${them || "there"}!` : them ? `Hey ${them}!` : "Hey!";
  const who = whoIAm(input.role, input.business);
  const local = "a local crew here in Harford County";
  let intro: string;
  switch (input.affiliation) {
    case "neighbor":
      intro = `It's ${me ?? "your neighbor"} from down the street. ${who}, ${local}.`;
      break;
    case "friend":
      intro = `${who}, a local landscaping crew in Harford County.`;
      break;
    case "family":
      intro = `As you know, ${who}.`;
      break;
    case "coworker":
      intro = `It's ${me ?? "me"} from work. ${who}, a local landscaping crew in Harford County.`;
      break;
    case "online_message":
      intro = `Thanks for reaching out! ${who}, ${local}.`;
      break;
    case "online_post":
      intro = `${who}, ${local}, and we'd be glad to help with this.`;
      break;
    default:
      intro = me ? `It's ${me}. ${who}, a local landscaping crew in Harford County.` : `${who}, a local landscaping crew in Harford County.`;
  }
  const ask = online
    ? `You can get an instant estimate here, and we'll reach out to set up the rest:\n${input.link}`
    : `If you ever need help with your yard, you can get an instant estimate here:\n${input.link}`;
  return [hi, intro, ask, "Thanks!"].join("\n\n");
}
