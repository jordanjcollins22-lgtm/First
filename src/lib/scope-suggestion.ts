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
