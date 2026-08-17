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
