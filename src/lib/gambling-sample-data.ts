/**
 * SAMPLE DATA ONLY — nothing here is real.
 *
 * Every account, balance, game, and cash-out figure below is invented for a
 * layout test. The team names are real NFL teams so the screen looks familiar,
 * but the matchups, scores, and prices did not happen. Nothing reads from
 * FanDuel or any other book, and there is no API behind this page.
 *
 * If this ever becomes something real, the shapes here are the contract to
 * fill from a live feed — that's the only reason it's typed rather than
 * hardcoded into the component.
 */

export interface GamblingAccount {
  id: string;
  person: string;
  /** What they started the week with. */
  startingBalance: number;
  balance: number;
  /** Money currently tied up in unsettled bets. */
  atRisk: number;
}

export type CashOutStatus = "offered" | "taken" | "declined";

export interface HalftimeBet {
  id: string;
  accountId: string;
  person: string;
  matchup: string;
  /** Score at the half, as the cash-out was offered. */
  halftimeScore: string;
  market: string;
  stake: number;
  /** What the book is offering to buy the ticket back for at the half. */
  cashOutOffer: number;
  /** What it would pay if it won outright. */
  fullPayout: number;
  status: CashOutStatus;
  kickoff: string;
}

export const SAMPLE_ACCOUNTS: GamblingAccount[] = [
  { id: "a1", person: "Brittany", startingBalance: 500, balance: 742.5, atRisk: 120 },
  { id: "a2", person: "Jeff", startingBalance: 500, balance: 618.25, atRisk: 75 },
  { id: "a3", person: "Sage 💛", startingBalance: 500, balance: 883.0, atRisk: 200 },
  { id: "a4", person: "Jordan", startingBalance: 1000, balance: 1455.75, atRisk: 250 },
  { id: "a5", person: "Chris", startingBalance: 500, balance: 466.0, atRisk: 60 },
  { id: "a6", person: "Megan", startingBalance: 500, balance: 705.5, atRisk: 150 },
  { id: "a7", person: "Josh", startingBalance: 750, balance: 928.0, atRisk: 100 },
  { id: "a8", person: "Tyler", startingBalance: 500, balance: 534.25, atRisk: 80 },
  { id: "a9", person: "Nicole", startingBalance: 500, balance: 612.0, atRisk: 45 },
  { id: "a10", person: "Devin", startingBalance: 500, balance: 489.75, atRisk: 130 },
];

export const SAMPLE_HALFTIME_BETS: HalftimeBet[] = [
  {
    id: "b1",
    accountId: "a4",
    person: "Jordan",
    matchup: "Ravens vs Bengals",
    halftimeScore: "Ravens 17 — Bengals 6",
    market: "Ravens −3.5",
    stake: 100,
    cashOutOffer: 168.4,
    fullPayout: 190.0,
    status: "offered",
    kickoff: "Sun 1:00 PM",
  },
  {
    id: "b2",
    accountId: "a3",
    person: "Sage 💛",
    matchup: "Chiefs vs Raiders",
    halftimeScore: "Chiefs 21 — Raiders 3",
    market: "Chiefs ML",
    stake: 200,
    cashOutOffer: 271.0,
    fullPayout: 296.0,
    status: "taken",
    kickoff: "Sun 1:00 PM",
  },
  {
    id: "b3",
    accountId: "a1",
    person: "Brittany",
    matchup: "Eagles vs Cowboys",
    halftimeScore: "Eagles 10 — Cowboys 10",
    market: "Over 44.5",
    stake: 120,
    cashOutOffer: 131.5,
    fullPayout: 228.0,
    status: "offered",
    kickoff: "Sun 4:25 PM",
  },
  {
    id: "b4",
    accountId: "a7",
    person: "Josh",
    matchup: "49ers vs Seahawks",
    halftimeScore: "49ers 14 — Seahawks 13",
    market: "49ers −6.5",
    stake: 100,
    cashOutOffer: 72.25,
    fullPayout: 190.0,
    status: "declined",
    kickoff: "Sun 4:25 PM",
  },
  {
    id: "b5",
    accountId: "a6",
    person: "Megan",
    matchup: "Bills vs Dolphins",
    halftimeScore: "Bills 20 — Dolphins 7",
    market: "Bills ML",
    stake: 150,
    cashOutOffer: 214.75,
    fullPayout: 247.5,
    status: "offered",
    kickoff: "Sun 8:20 PM",
  },
  {
    id: "b6",
    accountId: "a2",
    person: "Jeff",
    matchup: "Packers vs Lions",
    halftimeScore: "Packers 7 — Lions 24",
    market: "Packers +2.5",
    stake: 75,
    cashOutOffer: 18.5,
    fullPayout: 143.0,
    status: "declined",
    kickoff: "Sun 8:20 PM",
  },
  {
    id: "b7",
    accountId: "a10",
    person: "Devin",
    matchup: "Steelers vs Browns",
    halftimeScore: "Steelers 13 — Browns 9",
    market: "Under 38.5",
    stake: 130,
    cashOutOffer: 176.8,
    fullPayout: 247.0,
    status: "offered",
    kickoff: "Mon 8:15 PM",
  },
  {
    id: "b8",
    accountId: "a8",
    person: "Tyler",
    matchup: "Vikings vs Bears",
    halftimeScore: "Vikings 3 — Bears 17",
    market: "Vikings −1.5",
    stake: 80,
    cashOutOffer: 21.0,
    fullPayout: 152.0,
    status: "offered",
    kickoff: "Mon 8:15 PM",
  },
];

/** Cash-out offer divided by the stake — the "multiple" the screen leads with. */
export function cashOutMultiple(bet: HalftimeBet): number {
  return bet.cashOutOffer / bet.stake;
}

/* ------------------------------------------------------------------ *
 * Tie at halftime — the weekly play
 *
 * Still sample data. The strategy: every week, take the two games with the
 * best-priced "tied at halftime" market.
 * ------------------------------------------------------------------ */

export interface TieCandidate {
  id: string;
  week: number;
  matchup: string;
  kickoff: string;
  /** American odds on the game being tied at the half, e.g. +1100. */
  tieOdds: number;
  /** Our own estimate that this particular game ends the half level. */
  modelPct: number;
  /** Why this game looks more likely to sit level at the break than most. */
  reason: string;
}

export interface TieWeekResult {
  week: number;
  picks: {
    matchup: string;
    halftimeScore: string;
    tieOdds: number;
    tied: boolean;
  }[];
  stakePerBet: number;
}

/** What the book's price says the chance is, before its margin is removed. */
export function impliedProbability(americanOdds: number): number {
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

/** Hit rate needed just to break even at this price — the number that decides
 * whether the play is worth making at all. */
export function breakEvenRate(americanOdds: number): number {
  return impliedProbability(americanOdds);
}

/** Profit on a winning bet, stake excluded. */
export function profitOn(stake: number, americanOdds: number): number {
  return americanOdds > 0 ? stake * (americanOdds / 100) : stake * (100 / Math.abs(americanOdds));
}

export const CURRENT_WEEK = 4;

export const SAMPLE_TIE_SLATE: TieCandidate[] = [
  {
    id: "t1",
    week: 4,
    matchup: "Steelers vs Browns",
    kickoff: "Sun 1:00 PM",
    tieOdds: 1400,
    modelPct: 0.112,
    reason: "Two run-first offenses, lowest total on the board (37.5). Low-scoring halves tie most often.",
  },
  {
    id: "t2",
    week: 4,
    matchup: "Bears vs Vikings",
    kickoff: "Sun 1:00 PM",
    tieOdds: 1300,
    modelPct: 0.104,
    reason: "Spread inside a field goal, total under 40. Even matchup, few possessions.",
  },
  {
    id: "t3",
    week: 4,
    matchup: "Broncos vs Raiders",
    kickoff: "Sun 4:05 PM",
    tieOdds: 1200,
    modelPct: 0.095,
    reason: "Pick'em spread, but both offenses score in the red zone rather than settling for threes.",
  },
  {
    id: "t4",
    week: 4,
    matchup: "Giants vs Commanders",
    kickoff: "Sun 1:00 PM",
    tieOdds: 1100,
    modelPct: 0.088,
    reason: "Close spread, middling total. Nothing pushing it either way.",
  },
  {
    id: "t5",
    week: 4,
    matchup: "Texans vs Colts",
    kickoff: "Sun 4:25 PM",
    tieOdds: 1000,
    modelPct: 0.081,
    reason: "Total up at 47.5 — more scoring means more ways to end the half apart.",
  },
  {
    id: "t6",
    week: 4,
    matchup: "Chiefs vs Chargers",
    kickoff: "Sun 8:20 PM",
    tieOdds: 900,
    modelPct: 0.07,
    reason: "Chiefs favoured by a touchdown. Favourites that big are usually ahead at the break.",
  },
  {
    id: "t7",
    week: 4,
    matchup: "Bills vs Jets",
    kickoff: "Mon 8:15 PM",
    tieOdds: 850,
    modelPct: 0.064,
    reason: "Widest spread of the slate. Least likely to be level.",
  },
];

export const SAMPLE_TIE_HISTORY: TieWeekResult[] = [
  {
    week: 1,
    stakePerBet: 50,
    picks: [
      { matchup: "Bears vs Titans", halftimeScore: "10 — 3", tieOdds: 1300, tied: false },
      { matchup: "Steelers vs Falcons", halftimeScore: "6 — 0", tieOdds: 1200, tied: false },
    ],
  },
  {
    week: 2,
    stakePerBet: 50,
    picks: [
      { matchup: "Browns vs Jaguars", halftimeScore: "7 — 7", tieOdds: 1250, tied: true },
      { matchup: "Panthers vs Saints", halftimeScore: "13 — 3", tieOdds: 1150, tied: false },
    ],
  },
  {
    week: 3,
    stakePerBet: 50,
    picks: [
      { matchup: "Raiders vs Commanders", halftimeScore: "14 — 10", tieOdds: 1300, tied: false },
      { matchup: "Broncos vs Buccaneers", halftimeScore: "3 — 17", tieOdds: 1100, tied: false },
    ],
  },
];
