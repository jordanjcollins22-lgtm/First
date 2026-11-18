// The side panel: Start and Stop, your turn on a lead, feed vs search, the
// live log, posts waiting for your OK, and settings. It reads everything the
// Facebook page script writes to chrome.storage, so it is always current.

const APP = "https://app.jslandscapingmd.com";
const FEED_URL = "https://www.facebook.com/groups/feed/";
const $ = (id) => document.getElementById(id);
const api = (method, body) => chrome.runtime.sendMessage({ type: "api", method, body });
const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);
let me = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
async function log(text, kind = "info") {
  const { log: list = [] } = await get("log");
  list.push({ t: Date.now(), text, kind });
  await set({ log: list.slice(-150) });
}

/* ------------------------------------------------------------------ tabs */

for (const btn of document.querySelectorAll(".tab")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab")) b.classList.toggle("on", b === btn);
    for (const s of document.querySelectorAll("section")) s.hidden = s.id !== btn.dataset.tab;
    if (btn.dataset.tab === "posts") loadPosts();
  });
}

/* ------------------------------------------------------------------ who */

async function whoAmI() {
  const r = await api("GET");
  if (!r || !r.ok) {
    me = null;
    $("who").innerHTML = r && r.signedOut ? `Not signed in. <a href="${APP}/login" target="_blank">Sign in to the app</a>, then reopen this panel.` : esc((r && r.error) || "Couldn't reach the app.");
    return;
  }
  me = r;
  $("who").textContent = `${r.name || "Signed in"}${r.owner ? " · owner" : ""}${r.reader ? "" : " · post reader off (keyword check only)"}`;
  const n = r.posts ? r.posts.toReview : 0;
  $("post-count").textContent = n ? `(${n})` : "";
}

/* ------------------------------------------------------------------ start / stop */

async function findTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && /^https:\/\/www\.facebook\.com\//.test(active.url || "")) return active.id;
  const made = await chrome.tabs.create({ url: FEED_URL, active: true });
  return made.id;
}

$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  try {
    await whoAmI();
    if (!me) return;
    const { run = {} } = await get("run");
    if (run.blockedUntil && run.blockedUntil > Date.now()) {
      await log(`Facebook blocked an action earlier. Wait until ${new Date(run.blockedUntil).toLocaleString()} before starting again.`, "error");
      return;
    }
    const tabId = await findTab();
    await set({ run: { ...run, on: true, tabId, state: "finding", visit: null, current: null, note: null } });
    await log("Started.");
    if (me.owner) await schedule(true);
    await chrome.tabs.update(tabId, { url: FEED_URL, active: true });
  } finally {
    $("start").disabled = false;
  }
});

$("stop").addEventListener("click", async () => {
  const { run = {} } = await get("run");
  await set({ run: { ...run, on: false, state: "stopped", current: null, note: null } });
  await log("Stopped.");
});

async function tellPage(cmd) {
  const { run = {} } = await get("run");
  if (run.tabId) chrome.tabs.sendMessage(run.tabId, { type: "finder", cmd }).catch(() => {});
}
$("posted").addEventListener("click", () => tellPage("posted"));
$("skip").addEventListener("click", () => tellPage("skip"));
$("copy").addEventListener("click", async () => {
  const { run = {} } = await get("run");
  if (run.current) await navigator.clipboard.writeText(run.current.comment).catch(() => {});
  $("copy").textContent = "Copied";
  setTimeout(() => ($("copy").textContent = "Copy comment"), 1500);
});
$("reset-stats").addEventListener("click", () => set({ stats: {} }));

/* ------------------------------------------------------------------ render */

function rate(row) {
  const hours = (row.ms || 0) / 3600000;
  return hours > 0.01 ? row.leads / hours : null;
}

async function render() {
  const { run = {}, stats = {}, log: list = [], leads = [], counts = {} } = await get(["run", "stats", "log", "leads", "counts"]);
  $("start").hidden = Boolean(run.on);
  $("stop").hidden = !run.on;
  const where = run.visit ? (run.visit.source === "search" ? `searching “${run.visit.q}”` : "reading your groups feed") : "";
  $("state").textContent = run.on ? (run.state === "your-turn" ? "Waiting for you on a lead." : `Running${where ? `: ${where}` : ""}.`) : run.note || "Stopped.";

  const cur = run.on && run.current;
  $("turn").hidden = !cur;
  if (cur) {
    $("turn-who").textContent = cur.author || "Someone";
    $("turn-text").textContent = cur.text || "";
    $("turn-comment").textContent = cur.comment;
    $("turn-hint").textContent = cur.typed
      ? "It's typed in the comment box. Read it, change anything, then press Enter on Facebook to post it."
      : "Couldn't open the comment box on this one. Copy the comment, post it on Facebook, then press I posted it.";
  }

  const rows = ["feed", "search"].map((k) => ({ k, ...{ read: 0, leads: 0, ms: 0, visits: 0 }, ...(stats[k] || {}) }));
  const rates = rows.map(rate);
  const best = rates[0] == null && rates[1] == null ? -1 : (rates[0] ?? -1) >= (rates[1] ?? -1) ? 0 : 1;
  $("stats").innerHTML = rows
    .map((r, i) => `<tr class="${i === best ? "best" : ""}"><td>${r.k === "feed" ? "Groups feed" : "Search"}</td><td>${r.read}</td><td>${r.leads}</td><td>${rates[i] == null ? "–" : rates[i].toFixed(1)}</td></tr>`)
    .join("");
  $("winner").textContent =
    best < 0 ? "It tries both, then spends most of its time on whichever finds more leads per hour." : `${best === 0 ? "The groups feed" : "Search"} is finding more leads per hour, so it gets about 4 looks in 5.`;

  const s = { ...JSL_DEFAULTS, ...((await get("settings")).settings || {}) };
  const done = counts.day === `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}` ? counts.n : 0;
  $("today").textContent = `${done} of ${s.dailyCap} comments posted today. Comments are at least ${s.minutesBetween} minutes apart.`;

  $("log").innerHTML = list
    .slice(-60)
    .reverse()
    .map((e) => `<li class="${e.kind}"><time>${clock(e.t)}</time>${esc(e.text)}</li>`)
    .join("");
  $("leads").innerHTML = leads.length
    ? leads
        .slice(0, 40)
        .map((l) => `<li><b>${esc(l.author || "Someone")}</b>${l.group ? ` · ${esc(l.group)}` : ""} · ${clock(l.t)}<br>${esc(l.reason)}${l.url ? ` · <a href="${esc(l.url)}" target="_blank">open</a>` : ""}</li>`)
        .join("")
    : "<li>None yet.</li>";
}

chrome.storage.onChanged.addListener(render);

/* ------------------------------------------------------------------ posts */

async function schedule(quiet) {
  const r = await api("POST", { action: "schedule" });
  if (!r || !r.ok) {
    await log(`Scheduling: ${(r && r.error) || "no answer from the app"}`, "error");
    return;
  }
  if (r.scheduled && r.scheduled.length) {
    await log(`Scheduled ${r.scheduled.length} approved post${r.scheduled.length > 1 ? "s" : ""} on ${r.page}: ${r.scheduled.map((p) => p.when).join(", ")}.`, "done");
  } else if (r.needsMeta) {
    await log(`${r.waiting} approved post${r.waiting > 1 ? "s are" : " is"} waiting: connect the Facebook page in the Posts tab.`, "error");
  } else if (!quiet) {
    await log(r.message || "Nothing new to schedule.");
  }
  for (const p of r.problems || []) await log(`Scheduling: ${p}`, "error");
  if (!quiet) loadPosts();
}
$("schedule").addEventListener("click", () => schedule(false));

$("save-app").addEventListener("click", async () => {
  const r = await api("POST", { action: "meta-app", appId: $("app-id").value, appSecret: $("app-secret").value });
  $("app-secret").value = "";
  $("sched-state").textContent = r && r.ok ? "Saved. Now press Connect Facebook page." : (r && r.error) || "Couldn't save.";
});
$("connect").addEventListener("click", () => chrome.tabs.create({ url: `${APP}/api/meta/connect` }));

async function loadPosts() {
  await whoAmI();
  if (!me) return;
  if (!me.owner) {
    $("sched-state").textContent = "Only an owner approves and schedules posts.";
    $("review").innerHTML = "";
    return;
  }
  const m = me.meta || {};
  const p = me.posts || { toReview: 0, approved: 0, scheduled: 0 };
  $("meta-setup").hidden = Boolean(m.connected);
  $("sched-state").innerHTML = `${m.connected ? `Facebook page: <b>${esc(m.pageName)}</b>.` : "The Facebook page isn't connected yet, so approved posts wait here."} ${p.approved} approved and waiting for a day, ${p.scheduled} scheduled on Facebook.${m.lastError ? `<br><span class="warn">${esc(m.lastError)}</span>` : ""}`;

  const r = await api("POST", { action: "review" });
  const box = $("review");
  if (!r || !r.ok) {
    box.innerHTML = `<p class="hint">${esc((r && r.error) || "Couldn't load posts.")}</p>`;
    return;
  }
  if (!r.posts.length) {
    box.innerHTML = `<div class="card"><div class="label">Waiting for your OK</div><p class="hint">No before-and-after posts are waiting.</p></div>`;
    return;
  }
  box.innerHTML = `<div class="label" style="margin-top:14px">Waiting for your OK (${r.posts.length})</div>`;
  for (const post of r.posts) box.append(postCard(post));
}

function postCard(post) {
  const card = document.createElement("div");
  card.className = "card";
  const pics = post.pictures.map((u, i) => `<div><img src="${esc(u)}" alt=""><div class="tag">${post.pictures.length > 1 ? (i === 0 ? "Before" : "After") : "Before and after"}</div></div>`).join("");
  card.innerHTML = `
    ${post.stale ? `<div class="stale">Approved in the old app, but it never went out. Check it again.</div>` : ""}
    ${post.where ? `<div class="hint">${esc(post.where)}</div>` : ""}
    <div class="pics">${pics}</div>
    <label class="check"><input type="checkbox" class="photo-ok"> The before-and-after looks good</label>
    <label>Caption <textarea rows="6" class="caption">${esc(post.caption)}</textarea></label>
    <label class="check"><input type="checkbox" class="caption-ok"> The caption looks good</label>
    <p class="warn" hidden></p>
    <div class="row"><button class="primary approve" disabled>Approve</button><button class="ghost deny">Deny</button></div>`;
  const photo = card.querySelector(".photo-ok");
  const cap = card.querySelector(".caption-ok");
  const text = card.querySelector(".caption");
  const approve = card.querySelector(".approve");
  const warn = card.querySelector(".warn");
  const check = () => {
    const free = /\bfree\b/i.test(text.value);
    warn.hidden = !free;
    warn.textContent = free ? "This caption says “free”. We don't promise free; change it before approving." : "";
    approve.disabled = !(photo.checked && cap.checked && text.value.trim()) || free;
  };
  photo.addEventListener("change", check);
  cap.addEventListener("change", check);
  text.addEventListener("input", () => {
    cap.checked = false;
    check();
  });
  check();
  approve.addEventListener("click", async () => {
    approve.disabled = true;
    const r = await api("POST", { action: "decide", id: post.id, decision: "approve", photoOk: photo.checked, captionOk: cap.checked, caption: text.value });
    if (r && r.ok) {
      card.innerHTML = `<p class="hint">Approved. It goes on the next open day the next time the finder starts, or press Schedule approved posts now.</p>`;
      await whoAmI();
    } else {
      warn.hidden = false;
      warn.textContent = (r && r.error) || "Couldn't save.";
      check();
    }
  });
  card.querySelector(".deny").addEventListener("click", async () => {
    const reason = prompt("Why not? (optional)") || "";
    const r = await api("POST", { action: "decide", id: post.id, decision: "deny", reason });
    if (r && r.ok) {
      card.innerHTML = `<p class="hint">Denied.</p>`;
      await whoAmI();
    }
  });
  return card;
}

/* ------------------------------------------------------------------ settings */

const FIELDS = ["dailyCap", "minutesBetween", "maxAgeDays", "minutesPerVisit", "searches"];
async function loadSettings() {
  const s = { ...JSL_DEFAULTS, ...((await get("settings")).settings || {}) };
  for (const f of FIELDS) $(f).value = s[f];
}
$("save-settings").addEventListener("click", async () => {
  const s = {};
  for (const f of FIELDS) s[f] = f === "searches" ? $(f).value : Math.max(1, Number($(f).value) || JSL_DEFAULTS[f]);
  s.dailyCap = Math.min(20, s.dailyCap);
  s.minutesBetween = Math.max(2, s.minutesBetween);
  await set({ settings: s });
  $("saved").textContent = "Saved.";
  setTimeout(() => ($("saved").textContent = ""), 1500);
});

whoAmI();
loadSettings();
render();
