/**
 * Writing a zone's scope line from what the evaluator actually recorded.
 *
 * The evaluator types notes on a driveway, in a hurry, for themselves: "client
 * wants anything drooping trimmed, dog dug up the mulch". The client reads a
 * proposal. Turning the first into the second is a rewrite somebody does by
 * hand for every zone on every job, and it is the same rewrite every time.
 *
 * So this drafts it and stops. Nothing here saves: the account manager gets
 * text in the box they were already editing, and it is theirs to keep, change
 * or throw away before anything is approved.
 *
 * Two rules the business asked for are enforced on the way out rather than
 * left as instructions the model is trusted to have followed:
 *
 *  - No em dashes. A house style, and cheap to guarantee.
 *  - No material quantities. A number in a scope line reads as a commitment,
 *    and the quantities live on the rate card where they can be re-costed.
 *    The brief never carries them, so the model has nothing to quote, and
 *    anything numeric that turns up anyway is dropped rather than shown.
 */

export interface ZoneBrief {
  zoneName: string;
  serviceLabel: string;
  /** What the evaluator typed on site. The most useful line in here. */
  notes: string;
  /** The service's own checklist, as answered for this zone. */
  checklistAnswers: { label: string; value: string }[];
  /**
   * Material names only.
   *
   * Deliberately not the quantities or the costs: the model cannot mention a
   * number it was never given, which is a stronger guarantee than asking it
   * not to.
   */
  materials: string[];
}

/**
 * Laying out a scope that is already written.
 *
 * A different job from writing one, and the only rule that matters is that it
 * is not writing one. The wording is the business's and a client may be held
 * to it, so the model moves it and nothing else: no better verb, no tightened
 * sentence, no line quietly merged into the one above because they were
 * saying nearly the same thing.
 *
 * The instruction is here for the model's benefit. The guarantee is not: the
 * caller compares the content before and against after, and throws the reply
 * away if a single line changed. See scope-format.ts.
 */
export function tidySystemPrompt(): string {
  return [
    "You lay out a scope of work that somebody has already written. You are a typesetter, not a writer.",
    "",
    "Group the lines under the headings they belong to, put one thing on each line, and put the lines in the order the work happens.",
    "",
    "Rules:",
    "- Never add anything. Not a line, not a heading, not a clause, not a word.",
    "- Never remove anything. Every line that comes in goes out, including ones that repeat.",
    "- Never rewrite. Keep each line's own words. You may fix capitals at the start of a line and a stray comma at the end of one, and nothing else.",
    "- A heading goes on its own line with no bullet. Everything else starts with the bullet character and a space.",
    "- Leave a blank line between one heading's group and the next.",
    "- If the text is a written paragraph rather than a list, leave it as one paragraph.",
    "- Reply with the laid-out scope and nothing else. No preamble, no explanation, no quotation marks.",
  ].join("\n");
}

/** The scope to lay out, as the model sees it. */
export function tidyBrief(scopeText: string, serviceLabel: string): string {
  return [`Service: ${serviceLabel}`, "", "Scope of work as written:", scopeText.trim()].join("\n");
}

export function systemPrompt(): string {
  return [
    "You write one short scope line for one work area on a landscaping proposal. A homeowner reads it.",
    "",
    "You are given what the evaluator recorded on site: the service, their notes, and any checklist answers. Write what we will do there and what the owner gets out of it.",
    "",
    "Rules:",
    "- One to three sentences. Plain language, the way you would say it to the owner standing in the garden.",
    "- Describe the work, not the contract. No warranties, no conditions, no scheduling.",
    "- Never use an em dash or an en dash. Use a comma or a full stop.",
    "- Never give quantities, measurements, amounts or prices. Not for materials, not for area, not for time.",
    "- Only say what the notes and answers support. If they are thin, write less. Do not invent work nobody recorded.",
    "- No preamble, no heading, no quotation marks. Reply with the scope line and nothing else.",
  ].join("\n");
}

/** The facts for one zone, as the model sees them. */
export function briefFor(zone: ZoneBrief): string {
  const lines = [`Work area: ${zone.zoneName}`, `Service: ${zone.serviceLabel}`];

  if (zone.notes.trim()) lines.push(`Evaluator's notes: ${zone.notes.trim()}`);

  for (const answer of zone.checklistAnswers) {
    if (answer.value.trim()) lines.push(`${answer.label}: ${answer.value.trim()}`);
  }

  // Names only. See the note on ZoneBrief.materials.
  if (zone.materials.length > 0) lines.push(`Materials in use: ${zone.materials.join(", ")}`);

  return lines.join("\n");
}

/** Whether there is enough recorded to be worth asking about. */
export function worthSuggesting(zone: ZoneBrief): boolean {
  return Boolean(zone.notes.trim()) || zone.checklistAnswers.some((a) => a.value.trim());
}

const QUANTITY = new RegExp(
  [
    // A number against a unit: "3 cubic yards", "50 sq ft", "2 tons", "12in".
    String.raw`\b\d[\d,.]*\s*(?:cubic\s+)?(?:yards?|yds?|tons?|bags?|pallets?|loads?|`,
    String.raw`sq\.?\s*(?:ft|feet)|square\s+(?:feet|foot)|linear\s+(?:feet|foot)|`,
    String.raw`feet|foot|ft\b|inches|inch|in\.|pounds?|lbs?|gallons?|gal\b|`,
    String.raw`hours?|hrs?|days?|pieces?|units?|plants?|shrubs?|trees?|yards\b)`,
    // Or money, in any of the shapes a model writes it.
    String.raw`|\$\s*\d|\b\d[\d,.]*\s*dollars?\b`,
  ].join(""),
  "i"
);

/** Whether one sentence quotes an amount the scope line must not carry. */
export function hasQuantity(sentence: string): boolean {
  return QUANTITY.test(sentence);
}

/** Sentences, kept with the punctuation that ended them. */
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/**
 * The model's reply, made safe to drop straight into the box.
 *
 * Dashes are replaced rather than the reply rejected: a good sentence with the
 * wrong punctuation is still a good sentence. A quantity is different. It is a
 * number nobody checked appearing in something a client may hold us to, so the
 * sentence carrying it goes, and if that empties the reply the caller is told
 * nothing came back rather than being handed a fragment.
 */
export function cleanScopeText(raw: string): string {
  let text = raw.trim();

  // Models like to announce themselves. Drop a short opening label ending in
  // a colon, and any wrapping quotes.
  text = text.replace(/^[^\n:]{0,60}:\s*\n+/, "");
  text = text.replace(/^["'“”']+|["'“”']+$/g, "").trim();

  // The house style. A hyphen is left alone: "well-maintained" is not a dash.
  text = text.replace(/\s*[—–―]\s*/g, ", ");
  // That can leave a doubled comma where the model wrote ", —".
  text = text.replace(/,\s*,/g, ",").replace(/\s+,/g, ",");

  const kept = splitSentences(text).filter((sentence) => !hasQuantity(sentence));

  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The laid-out reply, made safe to drop straight into the box.
 *
 * Deliberately not `cleanScopeText`. That one joins sentences back into a
 * paragraph, which is the exact thing being undone here, and it drops any
 * sentence carrying a number. Dropping a sentence is removing something, and
 * removing something is the one thing this is not allowed to do -- the numbers
 * in a written scope are the business's own, in wording a client has been
 * quoted against, and they stay.
 *
 * So this only takes off what a model wraps a reply in, and applies the house
 * style on dashes. The guarantee that nothing else moved is the caller's, and
 * it is a comparison rather than a hope.
 */
export function cleanTidyText(raw: string): string {
  let text = raw.trim();

  // Models like to announce themselves, and to fence a block of text.
  text = text.replace(/^[^\n:]{0,60}:\s*\n+/, "");
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  text = text.replace(/^["'\u201c\u201d']+|["'\u201c\u201d']+$/g, "");

  // The house style. A hyphen is left alone: "well-maintained" is not a dash.
  text = text.replace(/\s*[\u2014\u2013\u2015]\s*/g, ", ").replace(/,\s*,/g, ",").replace(/\s+,/g, ",");

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
