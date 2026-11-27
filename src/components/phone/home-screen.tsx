"use client";

import Link from "next/link";
import { useState } from "react";

import type { MeScreen } from "@/lib/me-screen";
import "./home.css";

/** Line drawings for the icons, on a 24 by 24 grid. */
const GLYPH = {
  yes: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M8.5 12l2.5 2.5 4.5-5",
  check: "M5 12.5l4.5 4.5L19 7",
  chat: "M4 5h16v11H9l-5 4z",
  cal: "M4 7a2 2 0 012-2h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2z M4 10h16 M9 3v4 M15 3v4",
  search: "M16 11a5 5 0 11-10 0 5 5 0 0110 0z M20 20l-4.5-4.5",
  money: "M12 3v18 M16.5 7.5C16 5.8 14.3 5 12 5s-4.5 1-4.5 3 2 2.8 4.5 3.3 4.5 1.4 4.5 3.5-2 3.2-4.5 3.2-4.3-1-4.7-2.8",
  clock: "M20 12a8 8 0 11-16 0 8 8 0 0116 0z M12 7.5V12l3 2",
  cam: "M4 8h3.5L9 5.5h6L16.5 8H20v11H4z M15.2 13.5a3.2 3.2 0 11-6.4 0 3.2 3.2 0 016.4 0z",
  leaf: "M5 19C5 10 11 5 19 5c0 8-5 14-14 14z M5 19l8-8",
  sheet: "M7 4h10a2 2 0 012 2v13a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z M12 17v-5 M12 12c-2.5 0-3.5-1.5-3.5-3 2 0 3.5.8 3.5 3z M12 12c2.5 0 3.5-1.5 3.5-3-2 0-3.5.8-3.5 3z",
  people: "M12 8a3 3 0 11-6 0 3 3 0 016 0z M3.5 19c.5-3.5 2.8-5 5.5-5s5 1.5 5.5 5 M19.3 9a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z M16 14.2c2.4 0 4 1.4 4.5 4.3",
  truck: "M3 6h11v10H3z M14 9h4l3 3.5V16h-7 M8.8 17.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z M18.8 17.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z",
  pin: "M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z M14.3 10a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  wallet: "M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H4z M4 7l11-3v3 M15.5 13.5h2",
  stairs: "M4 20h4v-4h4v-4h4V8h4 M15 4h5v5",
  map: "M14.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z M6.4 7.2l3.7 3.2 M17.6 7.2l-3.7 3.2 M6.4 16.8l3.7-3.2 M17.6 16.8l-3.7-3.2 M6.8 6a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z M20.8 6a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z M6.8 18a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z M20.8 18a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z",
  huddle: "M4 10v4l3 .5V9.5z M7 9.5l10-4.5v14l-10-4.5 M9.5 15l1 4.5h2.5L12 16",
  doc: "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6",
  rain: "M7 15a4 4 0 01-.5-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 15z M8 18l-1 2.5 M12 18l-1 2.5 M16 18l-1 2.5",
  box: "M3.5 8L12 4l8.5 4v8.5L12 20.5 3.5 16.5z M3.5 8L12 12l8.5-4 M12 12v8.5",
  book: "M4 5c3-1 5.5-1 8 1 2.5-2 5-2 8-1v14c-3-1-5.5-1-8 1-2.5-2-5-2-8-1z M12 6v14",
  photo: "M5.5 5h13a2 2 0 012 2v10a2 2 0 01-2 2h-13a2 2 0 01-2-2V7a2 2 0 012-2z M10.8 10a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z M20.5 16l-5-5L6 19",
  star: "M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z",
  ask: "M20.5 12a8.5 8.5 0 11-17 0 8.5 8.5 0 0117 0z M9.6 9.5a2.5 2.5 0 114 2c-1 .6-1.6 1.2-1.6 2.3 M12 17h.01",
  chart: "M4 20h16 M7 16v-4 M11 16V8 M15 16v-6 M19 16V5",
  plus: "M12 7v10 M7 12h10 M7.5 3.5h9a4 4 0 014 4v9a4 4 0 01-4 4h-9a4 4 0 01-4-4v-9a4 4 0 014-4z",
  tag: "M4 4h7l9 9-7 7-9-9z M9.3 8a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0z",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M13 8l-3 4.5h4L11 17",
  off: "M6 5h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z M4 10h16 M9.5 13.5l5 4 M14.5 13.5l-5 4",
  trophy: "M8 4h8v5a4 4 0 01-8 0z M8 6H5c0 3 1.5 4.5 3 4.5 M16 6h3c0 3-1.5 4.5-3 4.5 M12 13v4 M8.5 20h7",
  payout: "M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z M14.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
} as const;

const COLOR = {
  teal: "linear-gradient(160deg,#1a7486,#0d4f5c)",
  lime: "linear-gradient(160deg,#a6db55,#6fa52b)",
  green: "linear-gradient(160deg,#4cd964,#22a843)",
  forest: "linear-gradient(160deg,#3d8b4f,#1f5a2e)",
  amber: "linear-gradient(160deg,#ffbf3d,#f08c00)",
  sky: "linear-gradient(160deg,#4fb3ff,#1773e0)",
  coral: "linear-gradient(160deg,#ff7a63,#e2412a)",
  slate: "linear-gradient(160deg,#5c6b70,#323d41)",
  plum: "linear-gradient(160deg,#9b6bd6,#5e3a9a)",
} as const;

/** Where an icon goes: a part of the full page, its own page, another site, or not built yet. */
type Go = { full: string } | { page: string } | { site: string } | { soon: true };
type App = { label: string; glyph: keyof typeof GLYPH; color: keyof typeof COLOR; what: string; go: Go };

const soon = { soon: true } as const;
const HIGHLEVEL = { site: "https://app.gohighlevel.com/" } as const;

const A = {
  yes: { label: "Your yes", glyph: "yes", color: "coral", what: "Everything waiting on your OK: payouts, weather moves, change orders and over-budget jobs.", go: { full: "s-waiting-on-you" } },
  ownerMoney: { label: "Money", glyph: "money", color: "amber", what: "Money in by location and ZIP code, and the 8% company fee.", go: { full: "s-all-locations" } },
  hlMsgs: { label: "Messages", glyph: "chat", color: "green", what: "Client texts stay in HighLevel for now.", go: HIGHLEVEL },
  msgs: { label: "Messages", glyph: "chat", color: "green", what: "Texts with your account manager and team, in the app.", go: soon },
  agentMap: { label: "Agent map", glyph: "map", color: "teal", what: "The 8 departments and what each agent did today.", go: soon },
  payments: { label: "Payments", glyph: "payout", color: "forest", what: "Payments in, payout requests to approve and mark sent.", go: { page: "/admin/payments" } },
  hiring: { label: "Hiring", glyph: "people", color: "plum", what: "New applicants, interviews and check-ins due.", go: { page: "/admin/hiring" } },
  ownerCrew: { label: "Crew", glyph: "truck", color: "forest", what: "Crew schedule for the next 2 weeks and the wait list.", go: { page: "/me/full?role=account-manager&app=s-crew-schedule-next-2-weeks" } },
  ownerReview: { label: "Project review", glyph: "chart", color: "slate", what: "Profit on projects and money in and out.", go: { page: "/me/full?role=account-manager&app=s-business" } },
  viewAs: { label: "View as", glyph: "eye", color: "sky", what: "See each role's screen, or open the app as one person on the team.", go: { page: "/admin/view-as" } },
  doNow: { label: "Do now", glyph: "check", color: "lime", what: "One task at a time: replies, follow-ups, new leads, proposals, payouts.", go: { full: "s-do-now" } },
  evals: { label: "Evaluations", glyph: "pin", color: "teal", what: "Paid visits: book them, go, price them on the map, then approve and send the proposal.", go: { full: "s-evaluations" } },
  schedule: { label: "Schedule", glyph: "cal", color: "sky", what: "Your day and the next 2 weeks: paid visits, interviews, check-ins.", go: { full: "s-your-schedule" } },
  clients: { label: "Clients", glyph: "search", color: "slate", what: "Search every client and project, or start a new estimate.", go: { full: "s-clients" } },
  crew: { label: "Crew", glyph: "truck", color: "forest", what: "Crew schedule for the next 2 weeks and the wait list.", go: { full: "s-crew-schedule-next-2-weeks" } },
  amHiring: { label: "Hiring", glyph: "people", color: "plum", what: "New applicants, interviews and check-ins due.", go: { full: "s-hiring" } },
  business: { label: "Money", glyph: "money", color: "amber", what: "Project review, money in and out, unpaid invoices.", go: { full: "s-business" } },
  approvals: { label: "Approvals", glyph: "yes", color: "coral", what: "Weather moves and over-budget jobs waiting on your OK before the client hears.", go: soon },
  order: { label: "Order list", glyph: "box", color: "amber", what: "Materials to order for upcoming jobs, closest supplier with the lowest price.", go: soon },
  receipts: { label: "Receipts", glyph: "cam", color: "amber", what: "Receipt photos the crews sent in, tied to each job.", go: soon },
  weather: { label: "Weather", glyph: "rain", color: "sky", what: "Rain and freeze flags 2 days out and at 5 AM, with suggested moves.", go: soon },
  huddle: { label: "Huddle", glyph: "huddle", color: "coral", what: "The 10-minute morning team huddle, step by step.", go: soon },
  prices: { label: "Price sheet", glyph: "tag", color: "slate", what: "Our rates and pricing in one sheet.", go: soon },
  plants: { label: "Plants", glyph: "leaf", color: "green", what: "Plant guide: photo, sun and water, spacing, when to plant and prune.", go: soon },
  weeds: { label: "Weed sheet", glyph: "sheet", color: "forest", what: "Common Harford County weeds: how to spot each one and how to remove it.", go: soon },
  reviews: { label: "Reviews", glyph: "star", color: "amber", what: "Google review requests sent and reviews that came in.", go: soon },
  today: { label: "Today", glyph: "clock", color: "lime", what: "Clock in and out, and today's jobs with their job sheets.", go: { full: "s-today" } },
  receipt: { label: "Receipt", glyph: "cam", color: "amber", what: "Snap a receipt and it gets tied to the job.", go: soon },
  route: { label: "Route", glyph: "pin", color: "teal", what: "Today's stops on a map with directions.", go: soon },
  materials: { label: "Materials", glyph: "box", color: "slate", what: "Mulch, stone and soil: colors, coverage per yard, what goes where.", go: soon },
  safety: { label: "Safety", glyph: "shield", color: "coral", what: "Thunder rule, equipment checks, heat and cold.", go: soon },
  training: { label: "Training", glyph: "book", color: "sky", what: "Short how-to videos for each skill.", go: soon },
  hours: { label: "Hours", glyph: "clock", color: "slate", what: "Your hours and jobs this pay period.", go: soon },
  timeOff: { label: "Time off", glyph: "off", color: "plum", what: "Ask for days off and see what's approved.", go: soon },
  ask: { label: "Ask", glyph: "ask", color: "teal", what: "Send a question to your account manager with a photo.", go: soon },
  sendLink: { label: "Send link", glyph: "link", color: "lime", what: "Send your link to someone and see who you sent it to.", go: { full: "s-send-your-link" } },
  wallet: { label: "Wallet", glyph: "wallet", color: "forest", what: "What you've earned and payouts.", go: { full: "s-wallet" } },
  stage: { label: "Stage", glyph: "stairs", color: "plum", what: "Your Stage of Success and what gets you to the next one.", go: { full: "s-stages-of-success" } },
  needsYou: { label: "Your yes", glyph: "yes", color: "coral", what: "What's waiting on you.", go: { full: "s-needs-you" } },
  locMoney: { label: "Money", glyph: "money", color: "amber", what: "Your location's revenue this week.", go: { full: "s-this-week-your-location" } },
  keep: { label: "You keep", glyph: "trophy", color: "amber", what: "What you keep this year.", go: { full: "s-you-keep-this-year" } },
  partnerSchedule: { label: "Schedule", glyph: "cal", color: "sky", what: "Your location's schedule.", go: soon },
  partnerCrew: { label: "Crew", glyph: "truck", color: "forest", what: "Your location's crew schedule.", go: soon },
  partnerHiring: { label: "Hiring", glyph: "people", color: "plum", what: "Hiring for your location.", go: soon },
  services: { label: "What we do", glyph: "leaf", color: "green", what: "Services we offer, so you know who to send your link to.", go: soon },
  photos: { label: "Before/after", glyph: "photo", color: "teal", what: "Real job photos to show people.", go: soon },
} satisfies Record<string, App>;

type Key = keyof typeof A;
// First version (Jordan, Nov 26): only what each role has to have. Dock = all the time.
const LAYOUT: Record<MeScreen, { title: string; dock: Key[]; apps: Key[] }> = {
  owner: { title: "Owner", dock: ["yes", "ownerMoney", "hiring", "hlMsgs"], apps: ["payments", "ownerCrew", "viewAs"] },
  "account-manager": { title: "Account manager", dock: ["doNow", "clients", "schedule", "hlMsgs"], apps: ["sendLink", "wallet", "evals", "crew", "amHiring", "business"] },
  technician: { title: "Technician", dock: ["today", "receipt", "ask", "wallet"], apps: ["plants", "weeds"] },
  partner: { title: "Location partner", dock: ["needsYou", "locMoney", "partnerSchedule", "msgs"], apps: ["partnerCrew", "partnerHiring"] },
  affiliate: { title: "Affiliate", dock: ["sendLink", "wallet", "stage", "ask"], apps: [] },
};

function Glyph({ k }: { k: keyof typeof GLYPH }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d={GLYPH[k]} />
    </svg>
  );
}

function Icon({ app }: { app: App }) {
  return (
    <span className="hs-ic" style={{ background: COLOR[app.color] }}>
      <Glyph k={app.glyph} />
    </span>
  );
}

/**
 * A role's home as a phone home screen: the four in the dock are what they
 * use all the time, the icons above what they use sometimes. Icons for parts
 * not built yet open a short note saying what they'll hold.
 */
export function HomeScreen({ role, name, previewing }: { role: MeScreen; name: string; previewing: MeScreen | null }) {
  const [open, setOpen] = useState<App | null>(null);
  const layout = LAYOUT[role];
  // Each icon opens a screen with only its own part.
  const only = (id: string) => `/me/full?app=${id}${previewing ? `&role=${previewing}` : ""}`;

  const tile = (k: Key) => {
    const app: App = A[k];
    const body = (
      <>
        <Icon app={app} />
        <span className="hs-lbl">{app.label}</span>
      </>
    );
    const go = app.go;
    if ("full" in go)
      return (
        <Link key={k} href={only(go.full)} className="hs-app">
          {body}
        </Link>
      );
    if ("page" in go)
      return (
        <Link key={k} href={go.page} className="hs-app">
          {body}
        </Link>
      );
    if ("site" in go)
      return (
        <a key={k} href={go.site} className="hs-app" target="_blank" rel="noreferrer">
          {body}
        </a>
      );
    return (
      <button key={k} type="button" className="hs-app" onClick={() => setOpen(app)} aria-label={`${app.label}, coming soon`}>
        {body}
      </button>
    );
  };

  return (
    <div className="hs">
      <div className="hs-hello">
        <b>Hi {name}</b>
        <span>{previewing ? `${layout.title} · preview` : layout.title}</span>
      </div>
      <nav className="hs-grid" aria-label="Sometimes">
        {layout.apps.map((k) => tile(k))}
      </nav>
      <div className="hs-fill" />
      <nav className="hs-dock" aria-label="All the time">
        {layout.dock.map((k) => tile(k))}
      </nav>
      {open && (
        <div className="hs-sheet" role="dialog" aria-label={open.label}>
          <div className="hs-sheet-h">
            <Icon app={open} />
            <b>{open.label}</b>
          </div>
          <p>{open.what}</p>
          <p className="hs-soon">Coming soon. It isn&apos;t built in the app yet.</p>
          <button type="button" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
