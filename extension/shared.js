/* eslint-disable @typescript-eslint/no-unused-vars -- globals shared with panel.js and finder.js */
// Settings and wording shared by the side panel and the Facebook page script.
// Loaded as a plain script in both places, so it only defines globals.

var JSL_DEFAULTS = {
  // Account safety: a real person presses post on every comment, and these
  // keep the number of comments low and spaced out.
  dailyCap: 8,
  minutesBetween: 6,
  maxAgeDays: 3,
  // How long one look at a source lasts before it's compared with the other.
  minutesPerVisit: 4,
  searches: [
    "landscaper Bel Air",
    "lawn care recommendation Bel Air",
    "landscaping Abingdon",
    "lawn service Fallston",
    "yard cleanup Harford County",
    "leaf removal Bel Air",
    "mulch Forest Hill",
    "landscaper recommendation Aberdeen",
    "lawn mowing Edgewood",
    "snow removal Bel Air",
    "hedge trimming Jarrettsville",
    "landscaping Havre de Grace",
  ].join("\n"),
};

// Harford County towns, places and ZIP codes. A post (or the group it's in)
// has to name one of these to count.
var JSL_PLACES = [
  "harford", "bel air", "belair", "abingdon", "aberdeen", "edgewood", "joppa", "joppatowne", "fallston",
  "forest hill", "jarrettsville", "havre de grace", "hdg", "churchville", "darlington", "pylesville",
  "whiteford", "street md", "belcamp", "perryman", "riverside", "emmorton", "bynum", "kalmia",
  "creswell", "hickory", "benson", "cardiff", "dublin md", "level md", "taylor md", "box hill", "greenridge",
  "21001", "21005", "21009", "21010", "21014", "21015", "21017", "21028", "21034", "21040", "21047",
  "21050", "21078", "21084", "21085", "21132", "21154", "21160", "21161",
];

// What the yard work is.
var JSL_SERVICES = [
  "landscap", "lawn", "mow", "grass", "yard", "mulch", "leaf", "leaves", "hedge", "shrub", "bush",
  "overgrown", "overgrowth", "flower bed", "flowerbed", "garden bed", "sod", "aerat", "overseed", "seed",
  "trim", "prune", "brush", "clean up", "cleanup", "clean-up", "edging", "snow", "plow", "salt",
  "gutter", "tree", "stump", "retaining wall", "paver", "patio", "drainage", "grading", "weeding",
];

// Someone asking, not offering.
var JSL_ASKING = [
  "looking for", "recommend", "recommendation", "anyone know", "anyone have", "does anyone", "can anyone",
  "need someone", "need a ", "needs a ", "need help", "in search of", "iso ", "who do you use", "who does",
  "suggestions", "any suggestions", "quote", "estimate", "hire", "hiring", "help with", "who would",
  "know of", "reliable", "affordable", "?",
];

// Someone offering their own service.
var JSL_ADVERT = [
  "we offer", "we provide", "call us", "call or text", "text us", "dm us", "dm me for", "message us",
  "booking now", "now booking", "licensed and insured", "licensed & insured", "free estimate",
  "fully insured", "our services", "taking new clients", "accepting new clients", "spots open",
  "get your free", "visit our", "check out our", "follow our page", "years of experience",
];

function jslHas(text, words) {
  const t = ` ${String(text || "").toLowerCase().replace(/\s+/g, " ")} `;
  return words.filter((w) => t.includes(w));
}

/** Keyword reading of one post: is it someone in the county asking for yard work? */
function jslKeywordCheck(post) {
  const text = `${post.text || ""}`;
  const place = jslHas(`${text} ${post.group || ""}`, JSL_PLACES);
  const service = jslHas(text, JSL_SERVICES);
  const asking = jslHas(text, JSL_ASKING);
  const advert = jslHas(text, JSL_ADVERT);
  if (!service.length) return { ok: false, why: "not about yard work" };
  if (advert.length) return { ok: false, why: `looks like an ad ("${advert[0]}")` };
  if (!asking.length) return { ok: false, why: "not asking for help" };
  if (!place.length) return { ok: false, why: "no Harford County town in it" };
  return { ok: true, why: `${service[0]} · ${place[0]}` };
}

/** "3h", "2d", "Yesterday", "Just now" → days old, or null when it can't tell. */
function jslAgeDays(label) {
  const s = String(label || "").toLowerCase().trim();
  if (!s) return null;
  if (/just now|now\b/.test(s)) return 0;
  if (/yesterday/.test(s)) return 1;
  const m = /(\d+)\s*(s|sec|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks|y|yr|year|years)\b/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const u = m[2][0];
    if (u === "s" || u === "m" || u === "h") return 0;
    if (u === "d") return n;
    if (u === "w") return n * 7;
    if (u === "y") return n * 365;
  }
  const date = Date.parse(`${s} ${new Date().getFullYear()}`);
  if (!Number.isNaN(date)) {
    let days = Math.floor((Date.now() - date) / 86400000);
    if (days < 0) days += 365;
    return days;
  }
  return null;
}
