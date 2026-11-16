import type { Position } from "@/lib/hiring/positions";

/**
 * Step 0.7 of the hiring structure: before anyone sees an ad, check it shows
 * our values, the responsibilities, the hours and the pay, and that it
 * doesn't sound corporate. What a program can check is checked here; the
 * last word is the person posting it.
 */

/** Words that make an ad sound like a big company wrote it. */
export const CORPORATE_WORDS = [
  "synergy",
  "leverage",
  "fast-paced environment",
  "self-starter",
  "go-getter",
  "rockstar",
  "ninja",
  "results-driven",
  "dynamic",
  "stakeholder",
  "best-in-class",
  "world-class",
  "team player",
  "wear many hats",
  "competitive salary",
  "other duties as assigned",
  "detail-oriented",
] as const;

export interface AdCheck {
  key: "pay" | "hours" | "duties" | "values" | "plain" | "growth";
  label: string;
  passed: boolean;
  /** Said when it fails: what to fix. */
  fix: string;
}

/** Each check, passed or not, in the order the structure lists them. */
export function reviewAd(position: Position, adBody: string): AdCheck[] {
  const text = adBody.toLowerCase();
  const found = CORPORATE_WORDS.filter((w) => text.includes(w));
  const hasPay = position.commissionOnly ? !!position.commission : position.pay != null;
  return [
    { key: "values", label: "Shows our values", passed: /respect|on time|cleaner|team|results/i.test(adBody), fix: "Say what we care about, like showing up on time and leaving it cleaner than we found it." },
    { key: "duties", label: "Lists the responsibilities", passed: position.duties.length >= 3, fix: "List at least three things they'll do." },
    { key: "hours", label: "Says the hours", passed: position.schedule.trim().length > 0, fix: "Say when they'll work." },
    { key: "pay", label: "Says the pay", passed: hasPay, fix: "Add the pay. Maryland job ads have to show it." },
    { key: "growth", label: "Says why it's a good job", passed: position.benefits.length >= 2, fix: "Add what they get besides pay: training, growth, perks." },
    {
      key: "plain",
      label: "Sounds like us, not a corporation",
      passed: found.length === 0,
      fix: found.length ? `Swap out: ${found.map((w) => `"${w}"`).join(", ")}.` : "",
    },
  ];
}

export function adReady(checks: readonly AdCheck[]): boolean {
  return checks.every((c) => c.passed);
}
