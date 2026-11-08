import { type CategoryKey, getCategory } from "./schedule-c";

/**
 * Keyword rules that turn a bank description into a category.
 *
 * Order matters: the first match wins, so specific rules (card payments,
 * transfers, tax payments) sit above broad ones (gas stations, big-box
 * stores). Anything a rule marks `review: true` is a best guess that a
 * person should confirm, because the same merchant can be business or
 * personal (Home Depot, Walmart, restaurants).
 */
export interface KeywordRule {
  pattern: RegExp;
  category: CategoryKey;
  /** Only match money in (+) or money out (-). */
  direction?: "in" | "out";
  review?: boolean;
  reason: string;
}

export const BUILT_IN_RULES: KeywordRule[] = [
  // Money moving between your own accounts and loans: never income/expense.
  { pattern: /\b(payment\s*(-\s*)?thank\s*you|autopay|card\s*payment|credit\s*card\s*(pmt|payment)|amex\s*epayment|chase\s*credit\s*crd|capital\s*one\s*(mobile\s*)?pymt|discover\s*e-?payment|citi\s*autopay)\b/i, category: "credit_card_payment", reason: "Credit card payment" },
  { pattern: /\b(online\s*transfer|transfer\s*(to|from)|xfer|internal\s*transfer|savings\s*transfer|funds\s*transfer)\b/i, category: "transfer", reason: "Transfer between accounts", review: true },
  { pattern: /\b(irs\s*usataxpymt|usataxpymt|eftps|irs\s*treas|us\s*treasury\s*tax|franchise\s*tax\s*bd|dept\s*of\s*revenue\s*income|state\s*income\s*tax|estimated\s*tax)\b/i, category: "income_tax_payment", reason: "Income tax payment", review: true },
  { pattern: /\b(sales\s*tax|dept\s*of\s*revenue|department\s*of\s*revenue|comptroller)\b/i, category: "sales_tax_remitted", direction: "out", reason: "State sales tax filing", review: true },
  { pattern: /\b(sba\s*loan|loan\s*(pmt|payment)|kubota\s*credit|deere\s*financial|john\s*deere\s*financial|ally\s*auto|toyota\s*financial|ford\s*credit|gm\s*financial)\b/i, category: "loan_principal", direction: "out", reason: "Loan/financing payment (split out interest)", review: true },
  { pattern: /\b(loan\s*(proceeds|advance|disbursement)|kabbage|ondeck|bluevine\s*loan)\b/i, category: "loan_proceeds", direction: "in", reason: "Loan proceeds", review: true },
  { pattern: /\b(atm\s*withdrawal|cash\s*withdrawal|atm\s*w\/d)\b/i, category: "owner_draw", direction: "out", reason: "Cash withdrawal (no receipt trail)", review: true },

  // Income
  { pattern: /\b(stripe\s*(transfer|payout)|square\s*inc|sq\s*\*?\s*payout|paypal\s*transfer|intuit\s*(payments|qbooks)\s*deposit|jobber\s*payout|ghl\s*payout|leadconnector\s*payout)\b/i, category: "income_sales", direction: "in", reason: "Card processor payout" },
  { pattern: /\b(mobile\s*deposit|remote\s*deposit|check\s*deposit|deposit\s*-?\s*check|counter\s*deposit|branch\s*deposit)\b/i, category: "income_sales", direction: "in", reason: "Check deposit", review: true },
  { pattern: /\b(interest\s*(paid|earned|payment)|int\s*earned)\b/i, category: "income_other", direction: "in", reason: "Bank interest earned" },
  { pattern: /\b(zelle|venmo|cash\s*app)\b/i, category: "income_sales", direction: "in", reason: "Peer-to-peer payment in (customer or personal?)", review: true },

  // Fees
  { pattern: /\b(stripe|square|sq\s*\*fee|paypal\s*fee|processing\s*fee|merchant\s*fee)\b/i, category: "processing_fees", direction: "out", reason: "Payment processing fee" },
  { pattern: /\b(service\s*(charge|fee)|monthly\s*(maintenance\s*|service\s*)?fee|wire\s*fee|overdraft|nsf\s*fee|account\s*fee)\b/i, category: "bank_fees", direction: "out", reason: "Bank fee" },
  { pattern: /\b(interest\s*charge|finance\s*charge|purchase\s*interest)\b/i, category: "interest_other", direction: "out", reason: "Interest / finance charge" },

  // Landscaping materials: plants, mulch, soil, stone.
  { pattern: /\b(siteone|site\s*one|ewing\s*irrigation|horizon\s*distribution|nursery|nurseries|garden\s*center|greenhouse|plant\s*(farm|depot|world)|tree\s*farm|sod\s*farm|landscape\s*supply|mulch|topsoil|stone\s*yard|stoneyard|rock\s*yard|pavers?|bfg\s*supply|ewing|john\s*deere\s*landscapes)\b/i, category: "job_materials", direction: "out", reason: "Nursery / landscape supply" },

  // Vehicles
  { pattern: /\b(shell|exxon|exxonmobil|mobil|chevron|bp#?|sunoco|marathon|valero|speedway|wawa|quiktrip|qt\s*\d|racetrac|circle\s*k|sheetz|casey'?s|love'?s|pilot|flying\s*j|kwik\s*trip|murphy\s*(usa|express)|7-eleven|citgo|phillips\s*66|conoco|costco\s*gas|sam'?s\s*club\s*fuel)\b/i, category: "vehicle", direction: "out", reason: "Fuel (truck or equipment?)", review: true },
  { pattern: /\b(jiffy\s*lube|valvoline|firestone|pep\s*boys|goodyear|discount\s*tire|tire\s*kingdom|midas|meineke|napa|autozone|o'?reilly|advance\s*auto|car\s*wash|dmv|tag\s*renewal|ez\s*pass|e-?zpass|sunpass|toll)\b/i, category: "vehicle", direction: "out", reason: "Vehicle maintenance / tolls" },

  // Equipment, rentals, repairs, supplies
  { pattern: /\b(sunbelt\s*rentals|united\s*rentals|herc\s*rentals|tool\s*rental|equipment\s*rental|u-?haul|bigge|h&e\s*equipment)\b/i, category: "equipment_rental", direction: "out", reason: "Equipment rental" },
  { pattern: /\b(small\s*engine|mower\s*repair|outdoor\s*power|power\s*equipment|stihl|husqvarna|echo\s*inc|exmark|scag|toro|ferris|kubota|bobcat)\b/i, category: "repairs", direction: "out", reason: "Outdoor power equipment dealer (repair or new equipment?)", review: true },
  { pattern: /\b(home\s*depot|the\s*home\s*depot|lowe'?s|menards|ace\s*hardware|true\s*value|tractor\s*supply|harbor\s*freight|northern\s*tool|grainger|fastenal|zoro)\b/i, category: "supplies", direction: "out", reason: "Hardware / supply store (supplies, materials, or personal?)", review: true },

  // Payroll sits above software so "QuickBooks Payroll" isn't read as a subscription.
  { pattern: /\b(gusto|adp|paychex|paylocity|rippling|onpay|quickbooks\s*payroll|intuit\s*payroll|payroll)\b/i, category: "wages", direction: "out", reason: "Payroll", review: true },

  // Marketing
  { pattern: /\b(google\s*\*?\s*ads\w*|facebk|facebook|meta\s*ads|meta\s*platforms|instagram|yelp|angi|angie'?s\s*list|homeadvisor|thumbtack|nextdoor|vistaprint|signs\s*now|fastsigns|bark\.com|porch\.com|networx)\b/i, category: "advertising", direction: "out", reason: "Advertising / lead service" },

  // Software, office, phone
  { pattern: /\b(gohighlevel|highlevel|leadconnector|quickbooks|intuit|jobber|housecall\s*pro|service\s*autopilot|lmn|aspire|mapbox|vercel|supabase|google\s*\*?(workspace|gsuite)|microsoft|adobe|canva|dropbox|zoom\.us|openai|anthropic|claude\.ai|github|squarespace|wix|godaddy|namecheap|staples|office\s*depot|officemax|usps|ups\s*store|fedex\s*office)\b/i, category: "office_software", direction: "out", reason: "Software / office" },
  { pattern: /\b(verizon|at&t|att\*|t-?mobile|sprint|comcast|xfinity|spectrum|cox\s*comm|frontier|google\s*fi|starlink|duke\s*energy|fpl|georgia\s*power|pg&e|dominion\s*energy|water\s*utility|city\s*of\s*\w+\s*utilities)\b/i, category: "utilities_phone", direction: "out", reason: "Phone / internet / utilities (business share only)", review: true },

  // Insurance, professional, payroll, licenses
  { pattern: /\b(next\s*insurance|hiscox|the\s*hartford|hartford|travelers|nationwide|progressive\s*commercial|state\s*farm|geico|allstate|liberty\s*mutual|erie\s*insurance|pie\s*insurance|workers\s*comp)\b/i, category: "insurance", direction: "out", reason: "Insurance (vehicle policies belong with Vehicle)", review: true },
  { pattern: /\b(cpa|accounting\s*(firm|services)|bookkeep|tax\s*prep|h&r\s*block|legalzoom|law\s*(office|firm)|attorney|esq\b|incfile|zenbusiness)\b/i, category: "professional_services", direction: "out", reason: "Professional services" },
  { pattern: /\b(business\s*license|license\s*fee|permit|secretary\s*of\s*state|sos\s*annual|annual\s*report\s*fee|dept\s*of\s*agriculture|pesticide)\b/i, category: "taxes_licenses", direction: "out", reason: "License / permit" },

  // Other operating costs
  { pattern: /\b(landfill|transfer\s*station|waste\s*management|republic\s*services|dumpster|green\s*waste|yard\s*waste|recycling\s*center)\b/i, category: "disposal_fees", direction: "out", reason: "Disposal fees" },
  { pattern: /\b(cintas|unifirst|work\s*n\s*gear|red\s*wing|boot\s*barn)\b/i, category: "uniforms", direction: "out", reason: "Uniforms / work gear" },
  { pattern: /\b(nalp|landscape\s*association|chamber\s*of\s*commerce|bbb\s*accred)\b/i, category: "dues_training", direction: "out", reason: "Dues" },
  { pattern: /\b(marriott|hilton|hampton\s*inn|holiday\s*inn|hyatt|best\s*western|airbnb|delta\s*air|american\s*air|united\s*air|southwest\s*air|expedia)\b/i, category: "travel", direction: "out", reason: "Travel (overnight trip?)", review: true },

  // Likely personal: kept off the return until someone says otherwise.
  { pattern: /\b(netflix|hulu|spotify|disney\s*plus|disney\+|hbo|max\.com|apple\.com\/bill|itunes|amazon\s*prime\s*video|playstation|xbox|steam\s*games|kroger|publix|safeway|aldi|trader\s*joe|whole\s*foods|wegmans|h-?e-?b|food\s*lion|giant\s*eagle|meijer|sephora|ulta|petsmart|petco|planet\s*fitness|la\s*fitness)\b/i, category: "personal", direction: "out", reason: "Typically personal", review: true },

  // Restaurants: only 50% deductible and often personal.
  { pattern: /\b(restaurant|grill|cafe|coffee|starbucks|dunkin|mcdonald'?s|chick-?fil-?a|wendy'?s|burger\s*king|taco\s*bell|chipotle|subway|panera|domino'?s|pizza|doordash|uber\s*eats|grubhub|waffle\s*house|cracker\s*barrel|bbq|diner|tst\*)\b/i, category: "meals", direction: "out", reason: "Restaurant (business meal or personal?)", review: true },
];

export interface UserRule {
  /** Case-insensitive substring matched against the normalized description. */
  match_text: string;
  category: CategoryKey;
}

export interface CategorizeInput {
  description: string;
  /** Positive = money in, negative = money out. */
  amount: number;
}

export interface CategorizeResult {
  category: CategoryKey;
  source: "user_rule" | "rule" | "default";
  confidence: number;
  needsReview: boolean;
  reason: string;
}

/** Collapse bank noise ("POS DEBIT 1234 HOME DEPOT #0412 ATLANTA GA") to something matchable. */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A short merchant key used when saving "always categorize this merchant as
 * X". Strips card/terminal noise and store numbers so one rule covers every
 * location.
 */
export function merchantKey(description: string): string {
  return normalizeDescription(description)
    .replace(/\b(pos|debit|credit|purchase|card|recurring|ach|web|ppd|ccd|id:?|ref:?|checkcard|visa|mc|dbt|crd|pmt|authorized\s+on\s+\d{1,2}\/\d{1,2})\b/g, " ")
    .replace(/#?\d{3,}/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/[*#]/g, " ")
    .replace(/\b[a-z]{2}\s*$/, " ") // trailing state code
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}

function directionMatches(rule: { direction?: "in" | "out" }, amount: number) {
  if (!rule.direction) return true;
  return rule.direction === "in" ? amount > 0 : amount < 0;
}

export function categorize(input: CategorizeInput, userRules: UserRule[] = []): CategorizeResult {
  const text = normalizeDescription(input.description);

  // Your own saved decisions always win over the built-in guesses.
  const userRule = userRules
    .filter((rule) => rule.match_text && text.includes(rule.match_text.toLowerCase()))
    .sort((a, b) => b.match_text.length - a.match_text.length)[0];
  if (userRule) {
    return {
      category: userRule.category,
      source: "user_rule",
      confidence: 1,
      needsReview: false,
      reason: `Your rule: "${userRule.match_text}"`,
    };
  }

  for (const rule of BUILT_IN_RULES) {
    if (!directionMatches(rule, input.amount)) continue;
    if (!rule.pattern.test(text)) continue;
    return {
      category: rule.category,
      source: "rule",
      confidence: rule.review ? 0.6 : 0.9,
      needsReview: Boolean(rule.review),
      reason: rule.reason,
    };
  }

  // No rule matched. Money in is most often a customer payment, but it could
  // be a transfer, loan or refund, so a person confirms it. Money out stays
  // in "needs review" rather than being guessed into a deduction.
  if (input.amount > 0) {
    return { category: "income_sales", source: "default", confidence: 0.4, needsReview: true, reason: "Unmatched deposit" };
  }
  return { category: "uncategorized", source: "default", confidence: 0, needsReview: true, reason: "No rule matched" };
}

/** True when a category is being used against its normal money direction (e.g. a "sale" that's money out). */
export function directionMismatch(category: CategoryKey, amount: number): boolean {
  const dir = getCategory(category).direction;
  if (dir === "either" || amount === 0) return false;
  return dir === "in" ? amount < 0 : amount > 0;
}
