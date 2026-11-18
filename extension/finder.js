// The lead finder on the Facebook page.
//
// Runs only in the one Facebook tab you pressed Start in. It scrolls your
// groups feed or a Facebook search for recent posts, outlines each post as it
// reads it, and when one is a neighbor in Harford County asking for yard work
// it scrolls to it, outlines it in green, opens the comment box and types a
// comment with your tracked link. Then it stops and waits: you read it and
// press Enter to post it yourself, or press Skip in the panel. It never
// presses post, likes, shares or messages anyone.
//
// Everything it does is written to chrome.storage, which the side panel reads,
// so the panel's log is a live record of what it is doing.
(() => {
  if (window.__jslFinder) return;
  window.__jslFinder = true;

  const FEED_URL = "https://www.facebook.com/groups/feed/";
  const POST_SEL = '[role="article"], div[aria-posinset], [data-pagelet^="FeedUnit"]';
  const BOX_SEL = 'div[contenteditable="true"][role="textbox"]';
  const BLOCK_WORDS = [
    "temporarily blocked",
    "you can't use this feature",
    "you can’t use this feature",
    "we limit how often",
    "action blocked",
    "your account has been restricted",
    "you're temporarily restricted",
    "you’re temporarily restricted",
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const between = (a, b) => a + Math.random() * (b - a);
  const get = (k) => chrome.storage.local.get(k);
  const set = (o) => chrome.storage.local.set(o);
  const api = (body) => chrome.runtime.sendMessage({ type: "api", method: "POST", body });

  let stopped = false;
  let running = false;
  let pausedMs = 0; // time spent waiting on you, which doesn't count against a source
  let pending = null; // the comment waiting on you: { resolve, id, box }

  /* ---------------------------------------------------------------- display */

  const pointer = document.createElement("div");
  pointer.className = "jsl-pointer";
  const bar = document.createElement("div");
  bar.className = "jsl-bar";

  function show() {
    if (!pointer.isConnected) document.documentElement.append(pointer, bar);
  }
  function hide() {
    pointer.remove();
    bar.remove();
  }
  function say(html) {
    show();
    bar.innerHTML = html;
  }
  function pointAt(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    pointer.style.left = `${Math.max(12, Math.min(innerWidth - 12, r.left + Math.min(r.width / 2, 160)))}px`;
    pointer.style.top = `${Math.max(12, Math.min(innerHeight - 12, r.top + Math.min(r.height / 2, 60)))}px`;
  }
  async function press(el) {
    pointAt(el);
    await sleep(650);
    pointer.classList.add("jsl-click");
    el.click();
    await sleep(200);
    pointer.classList.remove("jsl-click");
  }
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  /* ---------------------------------------------------------------- state */

  async function log(text, kind = "info") {
    const { log: list = [] } = await get("log");
    list.push({ t: Date.now(), text, kind });
    await set({ log: list.slice(-150) });
  }
  async function patchRun(patch) {
    const { run = {} } = await get("run");
    const next = { ...run, ...patch };
    await set({ run: next });
    return next;
  }
  async function settings() {
    const { settings: s = {} } = await get("settings");
    return { ...JSL_DEFAULTS, ...s };
  }
  async function bump(source, field, by = 1) {
    const { stats = {} } = await get("stats");
    const row = { read: 0, leads: 0, ms: 0, visits: 0, ...(stats[source] || {}) };
    row[field] += by;
    await set({ stats: { ...stats, [source]: row } });
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  /* ---------------------------------------------------------------- where */

  function searchUrl(q) {
    const filters = btoa(JSON.stringify({ "recent_posts:0": JSON.stringify({ name: "recent_posts", args: "" }) }));
    return `https://www.facebook.com/search/posts/?q=${encodeURIComponent(q)}&filters=${encodeURIComponent(filters)}`;
  }
  function sourceHere() {
    if (location.pathname.startsWith("/search/")) return "search";
    if (location.pathname.startsWith("/groups/feed")) return "feed";
    return null;
  }

  /**
   * Feed or search: whichever has found more leads per minute so far, with
   * one look in five at the other so a slow start doesn't decide it forever.
   */
  function pickSource(stats) {
    const f = { leads: 0, ms: 0, visits: 0, ...(stats.feed || {}) };
    const s = { leads: 0, ms: 0, visits: 0, ...(stats.search || {}) };
    if (f.visits < 1) return "feed";
    if (s.visits < 1) return "search";
    const rate = (x) => (x.leads + 0.5) / Math.max(1, x.ms / 60000);
    const best = rate(f) >= rate(s) ? "feed" : "search";
    return Math.random() < 0.8 ? best : best === "feed" ? "search" : "feed";
  }

  /* ---------------------------------------------------------------- reading */

  function topLevelPosts() {
    const all = [...document.querySelectorAll(POST_SEL)];
    return all.filter((el) => {
      if (el.dataset.jsl) return false;
      if (/^comment/i.test(el.getAttribute("aria-label") || "")) return false;
      const parent = el.parentElement && el.parentElement.closest(POST_SEL);
      if (parent) return false;
      return (el.innerText || "").trim().length > 30;
    });
  }

  const UI_LINES = /^(like|comment|share|reply|send|follow|join|see more|see translation|write a comment.*|all reactions:?|\d+ comments?|\d+ shares?|most relevant|·|top contributor|admin|moderator|author|facebook)$/i;

  function readPost(el) {
    const msgs = [...el.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')];
    let text = msgs.map((m) => m.innerText).join("\n").trim();
    if (!text) {
      text = (el.innerText || "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !UI_LINES.test(l))
        .join("\n");
    }
    text = text.slice(0, 1500);

    const authorEl = el.querySelector("h2 a, h3 a, h4 a, strong a, h2 span, h3 span, h4 span, strong span");
    const author = authorEl ? (authorEl.innerText || "").split("\n")[0].trim().slice(0, 80) : "";

    const anchors = [...el.querySelectorAll("a[href]")];
    const groupA = anchors.find((a) => /\/groups\/[^/?]+\/?(\?|$)/.test(a.getAttribute("href")) && (a.innerText || "").trim().length > 2);
    const group = groupA ? groupA.innerText.trim().slice(0, 120) : "";

    const postA = anchors.find((a) => /\/groups\/[^/]+\/(posts|permalink)\/|\/posts\/|story_fbid=|\/permalink\.php|\/permalink\//.test(a.getAttribute("href")));
    let url = "";
    if (postA) {
      try {
        const u = new URL(postA.href, location.origin);
        const keep = new URLSearchParams();
        for (const k of ["story_fbid", "id"]) if (u.searchParams.get(k)) keep.set(k, u.searchParams.get(k));
        url = `${u.origin}${u.pathname}${keep.toString() ? `?${keep}` : ""}`;
      } catch {}
    }

    let when = "";
    const candidates = [postA, ...anchors].filter(Boolean);
    for (const a of candidates) {
      const label = (a.getAttribute("aria-label") || a.innerText || "").trim();
      if (label && label.length < 40 && jslAgeDays(label) !== null) {
        when = label;
        break;
      }
    }
    if (!when) {
      const span = [...el.querySelectorAll("span")].find((s) => /^(\d+\s?(m|h|d|w|min|hr|hrs|mins)|yesterday|just now)$/i.test((s.innerText || "").trim()));
      if (span) when = span.innerText.trim();
    }
    return { text, author, group, url, when, ageDays: jslAgeDays(when) };
  }

  function keyOf(post) {
    if (post.url) return post.url;
    let h = 0;
    for (const c of post.text.slice(0, 300)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return `t${h}`;
  }

  /* ---------------------------------------------------------------- safety */

  function blockedHere() {
    const t = (document.body && document.body.innerText ? document.body.innerText.slice(0, 20000) : "").toLowerCase();
    return BLOCK_WORDS.find((w) => t.includes(w)) || null;
  }
  function signedOut() {
    return Boolean(document.querySelector('input[name="email"]') && document.querySelector('input[name="pass"]'));
  }

  /* ---------------------------------------------------------------- comment */

  async function openCommentBox(el) {
    let box = el.querySelector(BOX_SEL);
    if (!box) {
      const btn = [...el.querySelectorAll('[role="button"], [aria-label]')].find((b) => {
        const label = (b.getAttribute("aria-label") || "").trim();
        return /^(leave a comment|comment|write a comment)/i.test(label) || /^comment$/i.test((b.innerText || "").trim());
      });
      if (btn) {
        await press(btn);
        await sleep(1800);
      }
      box = el.querySelector(BOX_SEL) || document.querySelector(`[role="dialog"] ${BOX_SEL}`);
    }
    if (!box) return null;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(700);
    await press(box);
    box.focus();
    return box;
  }

  function boxText(box) {
    return (box.innerText || "").replace(/\s+/g, " ").trim();
  }

  /** Types it in where you can watch, a letter at a time. */
  async function typeInto(box, text) {
    box.focus();
    for (const ch of text) {
      if (stopped) return;
      document.execCommand("insertText", false, ch);
      await sleep(/[.,!?:]/.test(ch) ? between(120, 260) : between(18, 55));
    }
    // Facebook's box sometimes ignores typed letters; paste it whole instead.
    if (!boxText(box).includes(text.slice(0, 20))) {
      clearBox(box);
      const data = new DataTransfer();
      data.setData("text/plain", text);
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }
  }

  function clearBox(box) {
    if (!box || !box.isConnected) return;
    box.focus();
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
  }

  /** Waits for you: Enter in the box (posted), or Posted / Skip in the panel. */
  function waitForYou(box, id) {
    return new Promise((resolve) => {
      let typed = "";
      const onKey = (e) => {
        if (e.isTrusted && e.key === "Enter" && !e.shiftKey) {
          typed = boxText(box);
          setTimeout(() => {
            if (!boxText(box)) finish("posted", typed);
          }, 1500);
        }
      };
      if (box) box.addEventListener("keydown", onKey, true);
      const finish = (how, text) => {
        if (box) box.removeEventListener("keydown", onKey, true);
        pending = null;
        resolve({ how, text: text || typed || (box ? boxText(box) : "") });
      };
      pending = { id, box, finish };
    });
  }

  async function handleLead(el, post, reason, source, service) {
    const s = await settings();
    const { counts = {}, run = {} } = await get(["counts", "run"]);
    const day = counts.day === today() ? counts : { day: today(), n: 0 };

    const { leads = [] } = await get("leads");
    leads.unshift({ t: Date.now(), author: post.author, url: post.url, text: post.text.slice(0, 280), reason, source, group: post.group });
    await set({ leads: leads.slice(0, 100) });

    if (day.n >= s.dailyCap) {
      await log(`Lead found (${post.author || "someone"}), but today's ${s.dailyCap} comments are done. Saved to Leads.`, "lead");
      return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("jsl-read", "jsl-reading");
    el.classList.add("jsl-lead");
    const badge = document.createElement("div");
    badge.className = "jsl-badge";
    badge.textContent = `Lead: ${reason}`;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.append(badge);
    await log(`Lead: ${post.author || "someone"}${post.group ? ` in ${post.group}` : ""}: ${reason}`, "lead");

    const pauseStart = Date.now();
    try {
      await commentOn(el, post, reason, service, s, run, badge);
    } finally {
      pausedMs += Date.now() - pauseStart;
    }
  }

  async function commentOn(el, post, reason, service, s, run, badge) {
    const gap = s.minutesBetween * 60000 - (Date.now() - (run.lastCommentAt || 0));
    if (gap > 0) {
      await log(`Spacing comments out: waiting ${Math.ceil(gap / 60000)} min before typing this one.`);
      const until = Date.now() + gap;
      while (Date.now() < until && !stopped) {
        say(`<b>Lead found.</b> Typing the comment in ${Math.ceil((until - Date.now()) / 1000)}s (comments are spaced ${s.minutesBetween} min apart).`);
        await sleep(1000);
      }
      if (stopped) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    say("<b>Lead found.</b> Making your tracked link and comment…");
    const made = await api({ action: "draft", author: post.author, url: post.url, group: post.group, summary: reason, service });
    if (!made || !made.ok) {
      await log(`Couldn't make the comment: ${(made && made.error) || "no answer from the app"}`, "error");
      return;
    }

    say("<b>Opening the comment box…</b>");
    const box = await openCommentBox(el);
    if (box) {
      say("<b>Typing the comment…</b>");
      await typeInto(box, made.comment);
      if (stopped) {
        clearBox(box);
        await api({ action: "skip", id: made.id });
        return;
      }
    } else {
      await log("Couldn't open the comment box on this post. The comment is in the panel to copy.", "error");
    }
    await patchRun({ state: "your-turn", current: { id: made.id, author: post.author, url: post.url, text: post.text.slice(0, 400), reason, comment: made.comment, typed: Boolean(box) } });
    say(box ? "<b>Your turn.</b> Read it, change anything you like, then press <b>Enter</b> to post it. Or press Skip in the panel." : "<b>Your turn.</b> Copy the comment from the panel and post it, then press Posted. Or Skip.");

    const outcome = await waitForYou(box, made.id);
    badge.remove();
    el.classList.remove("jsl-lead");
    el.classList.add("jsl-read");

    if (outcome.how === "posted") {
      await api({ action: "posted", id: made.id, text: outcome.text || made.comment });
      const { counts: c2 = {} } = await get("counts");
      const d2 = c2.day === today() ? c2 : { day: today(), n: 0 };
      await set({ counts: { day: d2.day, n: d2.n + 1 } });
      await patchRun({ state: "finding", current: null, lastCommentAt: Date.now() });
      await log(`Posted on ${post.author ? `${post.author}'s` : "their"} post. Logged to People you sent it to.`, "done");
    } else {
      clearBox(box);
      await api({ action: "skip", id: made.id });
      await patchRun({ state: "finding", current: null });
      await log(`Skipped ${post.author ? `${post.author}'s` : "that"} post.`);
    }
  }

  /* ---------------------------------------------------------------- loop */

  async function readOne(el, source) {
    el.dataset.jsl = "1";
    el.classList.add("jsl-reading");
    pointAt(el);
    await sleep(between(350, 700));
    el.classList.remove("jsl-reading");
    el.classList.add("jsl-read");

    const post = readPost(el);
    await bump(source, "read");
    const s = await settings();
    const key = keyOf(post);
    const { seen = [] } = await get("seen");
    if (seen.includes(key)) return;
    await set({ seen: [...seen.slice(-2999), key] });

    if (post.ageDays !== null && post.ageDays > s.maxAgeDays) return;
    const kw = jslKeywordCheck(post);
    if (!kw.ok) return;

    say(`<b>Checking a post</b> from ${esc(post.author || "someone")}…`);
    const verdict = await api({ action: "check", text: post.text, group: post.group, url: post.url, when: post.when, author: post.author });
    if (verdict && verdict.ok && verdict.lead === false) {
      await log(`Passed on ${post.author || "a post"}: ${verdict.reason}`);
      return;
    }
    if (verdict && verdict.ageDays != null && verdict.ageDays > s.maxAgeDays) return;
    await bump(source, "leads");
    await handleLead(el, post, (verdict && verdict.lead && verdict.reason) || kw.why, source, verdict && verdict.service);
  }

  async function visit(run) {
    const s = await settings();
    const source = run.visit.source;
    let visitEnds = run.visit.started + s.minutesPerVisit * 60000;
    let quiet = 0;
    let lastTick = Date.now();
    say(source === "search" ? `<b>Searching</b> “${esc(run.visit.q)}”, recent posts` : "<b>Reading your groups feed</b>");
    await sleep(2500);

    while (!stopped && Date.now() < visitEnds) {
      const blocked = blockedHere();
      if (blocked) {
        await patchRun({ on: false, state: "stopped", blockedUntil: Date.now() + 86400000, note: `Facebook showed “${blocked}”. Stopped for a day.` });
        await log(`Facebook showed “${blocked}”. Stopped for 24 hours to protect the account. Don't turn it back on today.`, "error");
        stopped = true;
        break;
      }
      const posts = topLevelPosts();
      if (posts.length === 0) quiet += 1;
      else quiet = 0;
      for (const el of posts) {
        if (stopped) break;
        await readOne(el, source);
      }
      if (stopped) break;
      if (quiet >= 6) {
        await log(source === "search" ? `No more results for “${run.visit.q}”.` : "Reached the end of the feed for now.");
        break;
      }
      say(source === "search" ? `<b>Scrolling</b> results for “${esc(run.visit.q)}”` : "<b>Scrolling</b> your groups feed");
      window.scrollBy({ top: innerHeight * between(0.55, 0.8), behavior: "smooth" });
      await sleep(between(2200, 4200));
      // Time spent waiting on you isn't counted against the source.
      const now = Date.now();
      await bump(source, "ms", Math.max(0, now - lastTick - pausedMs));
      visitEnds += pausedMs;
      pausedMs = 0;
      lastTick = now;
    }
    await bump(source, "visits");
    await patchRun({ visit: null });
  }

  async function startVisit() {
    const { stats = {}, run = {} } = await get(["stats", "run"]);
    const s = await settings();
    const source = pickSource(stats);
    const searches = String(s.searches || "").split("\n").map((q) => q.trim()).filter(Boolean);
    if (source === "search" && searches.length) {
      const i = (run.searchIndex || 0) % searches.length;
      const q = searches[i];
      await patchRun({ visit: { source, q, started: Date.now() }, searchIndex: i + 1, state: "finding" });
      await log(`Searching Facebook for recent posts: “${q}”.`);
      location.href = searchUrl(q);
      return true;
    }
    await patchRun({ visit: { source: "feed", started: Date.now() }, state: "finding" });
    await log("Reading your groups feed.");
    if (sourceHere() === "feed" && !window.__jslReadFeedHere) {
      // Already on the feed: read it from the top without reloading.
      window.__jslReadFeedHere = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return false;
    }
    location.href = FEED_URL;
    return true;
  }

  async function main() {
    if (running) return;
    running = true;
    try {
      await loop();
    } finally {
      running = false;
    }
  }

  async function loop() {
    const answer = await chrome.runtime.sendMessage({ type: "am-i-the-finder" }).catch(() => null);
    if (!answer || !answer.yes) return;
    stopped = false;
    show();
    if (signedOut()) {
      await patchRun({ on: false, state: "stopped", note: "Sign in to Facebook in this tab, then press Start again." });
      await log("Facebook isn't signed in in this tab.", "error");
      hide();
      return;
    }
    while (!stopped) {
      const { run = {} } = await get("run");
      if (!run.on) break;
      const here = sourceHere();
      const q = new URLSearchParams(location.search).get("q");
      const fresh = run.visit && Date.now() - run.visit.started < ((await settings()).minutesPerVisit + 1) * 60000;
      const matches = run.visit && here === run.visit.source && (here !== "search" || q === run.visit.q);
      if (fresh && matches) {
        await visit(run);
        continue;
      }
      if (await startVisit()) return;
    }
  }

  /* ---------------------------------------------------------------- control */

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "finder") return;
    if (message.cmd === "posted" && pending) pending.finish("posted");
    if (message.cmd === "skip" && pending) pending.finish("skip");
    if (message.cmd === "start") {
      stopped = false;
      main();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.run && changes.run.newValue && !changes.run.newValue.on && changes.run.oldValue && changes.run.oldValue.on) {
      stopped = true;
      if (pending) pending.finish("skip");
      say("<b>Stopped.</b>");
      setTimeout(hide, 2500);
    }
  });

  main();
})();
