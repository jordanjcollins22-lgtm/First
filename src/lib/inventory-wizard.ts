/**
 * Adding something to inventory, one question at a time.
 *
 * A single long form is fine for whoever built it and hostile to everybody
 * else: fourteen fields on a phone, half of them meaningless for what you are
 * adding, and no signal about which ones matter. The ones that get skipped
 * are always the same ones — where it is kept, when to reorder — and they are
 * exactly the ones that make the inventory worth having.
 *
 * So: one question, then the next, and which questions get asked depends on
 * the answers so far. A rented machine is never asked what it costs to buy. A
 * fee is never asked where it is stored.
 *
 * The order and the branching live here, as data, so the thing that decides
 * what to ask can be tested without rendering anything.
 */

export type WizardKind = "tool" | "material" | "other";
export type Ownership = "own" | "rent";
export type StockMethod = "in_stock" | "order_as_needed";

export interface WizardAnswers {
  kind: WizardKind;
  name: string;
  ownership: Ownership;
  /** Object URL or path — presence is what matters to the step logic. */
  photo: string | null;
  unit: string;
  /** How much one of it covers or makes. */
  coverage: string;
  wastePct: string;
  /** What a pack holds and what a pack costs, which divide into a unit price. */
  packSize: string;
  packCost: string;
  /** Straight per-unit price, or a day rate for a rental. */
  unitCost: string;
  stockMethod: StockMethod;
  storageLocation: string;
  shopLocation: string;
  quantityOnHand: string;
  reorderThreshold: string;
  kits: number[];
  purchaseUrl: string;
  description: string;
  isDelivered: boolean;
}

export const EMPTY_ANSWERS: WizardAnswers = {
  kind: "material",
  name: "",
  ownership: "own",
  photo: null,
  unit: "",
  coverage: "",
  wastePct: "10",
  packSize: "",
  packCost: "",
  unitCost: "",
  stockMethod: "in_stock",
  storageLocation: "",
  shopLocation: "",
  quantityOnHand: "",
  reorderThreshold: "",
  kits: [],
  purchaseUrl: "",
  description: "",
  isDelivered: false,
};

export type StepId =
  | "kind"
  | "name"
  | "ownership"
  | "photo"
  | "unit"
  | "cost"
  | "coverage"
  | "stock_method"
  | "where"
  | "levels"
  | "kits"
  | "buying"
  | "review";

export interface WizardStep {
  id: StepId;
  /** The question, asked as a question. */
  title: string;
  hint?: string;
  /** Skippable. Everything load-bearing is not. */
  optional?: boolean;
}

/**
 * Which questions this particular thing needs, in order.
 *
 * Nothing is asked that the answers so far have already ruled out — which is
 * the whole point of asking one at a time rather than showing everything and
 * hoping somebody works out which half applies.
 */
export function stepsFor(answers: WizardAnswers): WizardStep[] {
  const steps: WizardStep[] = [
    { id: "kind", title: "What are we adding?" },
    { id: "name", title: "What is it called?", hint: "The name you would look it up under." },
  ];

  if (answers.kind === "tool") {
    steps.push({
      id: "ownership",
      title: "Do we own it, or rent it?",
      hint: "A rental has no resale value — it was never ours to sell.",
    });
  }

  steps.push({ id: "photo", title: "Take or pick a photo", hint: "So the crew knows it on sight." });

  if (answers.kind !== "tool") {
    steps.push({
      id: "unit",
      title: "What is one of it?",
      hint: "A bag, a sheet, a yard, an hour. What you would order and count.",
    });
  }

  steps.push({
    id: "cost",
    title:
      answers.kind === "tool"
        ? answers.ownership === "rent"
          ? "What does it cost to rent, per day?"
          : "What does it cost to buy?"
        : "What does it cost?",
    hint:
      answers.kind === "tool"
        ? undefined
        : "Give what a pack holds and what a pack costs, and the price of one works itself out.",
  });

  if (answers.kind === "material") {
    steps.push({
      id: "coverage",
      title: "How much does one of them do?",
      hint: "A bag covers a hundred square feet; a sheet makes one hanger. Skip it if it does not apply.",
      optional: true,
    });
  }

  // A fee is not stock. Nobody keeps permits on a shelf.
  if (answers.kind !== "other") {
    steps.push({
      id: "stock_method",
      title: "Do we keep it in stock, or order it when we need it?",
    });

    if (answers.stockMethod === "in_stock") {
      steps.push({
        id: "where",
        title: "Where is it kept?",
        hint: "The one everybody forgets, and the one that costs an hour when it is missing.",
      });
      steps.push({
        id: "levels",
        title: "How many now, and when should we reorder?",
      });
    }
  }

  if (answers.kind === "tool") {
    steps.push({
      id: "kits",
      title: "Which kits does it belong to?",
      hint: "Skip it if you do not use kits.",
      optional: true,
    });
  }

  steps.push({
    id: "buying",
    title: "Where do we buy it?",
    hint: "Paste a link and the name and description can fill themselves in.",
    optional: true,
  });

  steps.push({ id: "review", title: "Check it over" });
  return steps;
}

/**
 * What is wrong with the answer to this step, or nothing.
 *
 * Checked per step rather than all at the end, so nobody reaches a review
 * screen and is sent back through six questions to find the one that was
 * blank.
 */
export function problemWith(step: StepId, answers: WizardAnswers): string | null {
  switch (step) {
    case "name":
      return answers.name.trim() ? null : "Give it a name.";
    case "photo":
      return answers.photo ? null : "A photo is how the crew knows it on sight.";
    case "unit":
      return answers.unit.trim() ? null : "Say what one of it is — a bag, a sheet, a yard.";
    case "cost": {
      const priced =
        answers.unitCost.trim() !== "" ||
        (answers.packSize.trim() !== "" && answers.packCost.trim() !== "");
      if (priced) return null;
      return answers.kind === "tool"
        ? "Put a number on it, even a rough one."
        : "Give a price per unit, or what a pack holds and costs.";
    }
    case "where":
      return answers.storageLocation.trim()
        ? null
        : "Say where it lives — this is the one that costs an hour when it is missing.";
    default:
      return null;
  }
}

/** Everything still unanswered, for the review screen to own up to. */
export function outstanding(answers: WizardAnswers): string[] {
  return stepsFor(answers)
    .filter((step) => !step.optional)
    .map((step) => problemWith(step.id, answers))
    .filter((problem): problem is string => problem != null);
}

/**
 * The answers as the form fields the existing server actions already expect.
 *
 * Deliberately the same contract as the long form rather than a new one: two
 * ways of writing an inventory row is how the two drift apart.
 */
export function fieldsFor(answers: WizardAnswers): Record<string, string> {
  const fields: Record<string, string> = {
    name: answers.name.trim(),
    purchase_url: answers.purchaseUrl.trim(),
    description: answers.description.trim(),
    shop_location: answers.shopLocation.trim(),
    is_delivered: answers.isDelivered ? "on" : "",
  };

  // A fee is never stock, whatever was clicked before the kind was changed.
  const stockMethod = answers.kind === "other" ? "order_as_needed" : answers.stockMethod;
  fields.stock_method = stockMethod;
  fields.storage_location = stockMethod === "in_stock" ? answers.storageLocation.trim() : "";

  if (answers.kind === "tool") {
    fields.cost = answers.unitCost.trim();
    fields.is_rental = answers.ownership === "rent" ? "on" : "";
    fields.kits = answers.kits.join(",");
    fields.quantity = answers.quantityOnHand.trim();
    fields.reorder_threshold = answers.reorderThreshold.trim();
    return fields;
  }

  fields.unit = answers.unit.trim();
  fields.kind = answers.kind === "other" ? "other" : "material";
  fields.cost_per_unit = answers.unitCost.trim();
  fields.pack_size = answers.packSize.trim();
  fields.pack_cost = answers.packCost.trim();
  fields.coverage_per_unit_sqft = answers.coverage.trim();
  fields.waste_factor_pct = answers.wastePct.trim() || "10";
  fields.quantity_on_hand = answers.quantityOnHand.trim();
  fields.reorder_threshold = answers.reorderThreshold.trim();
  return fields;
}
