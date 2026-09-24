// The group agent, in the browser: the finder.
//
// Once a minute an alarm fires and at most one page gets looked at: the
// groups feed, a search, or a listed group, whichever is most overdue.
// Every post it reads is sent to the app, which sorts it and puts the
// people asking for work on the team's Posts to answer board.
//
// It never comments, likes, shares or messages. One account answering
// every lead in the county is what gets an account banned, so the
// answering is done by people, each from their own account, off the board.
// The only thing it presses on Facebook is a post's "Copy link", to bring
// back a link for a post the page showed without one.
//
// Nothing here knows what a Facebook page looks like. Every selector and
// every wait comes from the app in the "recipe", asked for each minute
// alongside the settings, so a layout change is fixed in the app and this
// copy has it within a minute with nothing to download. When the app wants
// newer extension code it says so, and the popup shows a download link.
//
// Three places it looks. The account's own groups feed, which is every
// group it is in on one page. Facebook's post search, for the phrases set
// in the app, which reaches public groups it is not in yet. And any group
// listed by hand in the app.
//
// It runs as you, in your Chrome, on your account. Nothing here logs in
// anywhere: the app is reached with the app's own cookies, and Facebook
// with Facebook's. Close Chrome and it stops.

const APP = "https://app.jslandscapingmd.com";
const BOARD = `${APP}/admin/outreach/posts`;
const API = `${APP}/api/outreach/agent`;
const TICK = "agent-tick";
const LOCK_MS = 3 * 60 * 1000;
const VERSION = chrome.runtime.getManifest().version;

chrome.runtime.onInstalled.addListener(() => arm());
chrome.runtime.onStartup.addListener(() => arm());

async function arm() {
  const existing = await chrome.alarms.get(TICK);
  if (!existing) await chrome.alarms.create(TICK, { periodInMinutes: 1 });
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === "to-answer") chrome.tabs.create({ url: BOARD });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) tick().catch((err) => setStatus(`Stopped on an error: ${err?.message ?? err}`));
});

// The popup talks to this. Every answer is the current state, so the popup
// has one thing to render.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  (async () => {
    if (message?.type === "status") reply(await snapshot());
    else if (message?.type === "look-now") {
      await chrome.storage.local.set({ scans: {} });
      await tick({ force: true });
      reply(await snapshot());
    } else if (message?.type === "answer-by-hand") {
      await answerByHand(message.tabId);
      reply({ ok: true });
    } else reply({ ok: false });
  })().catch((err) => reply({ error: String(err?.message ?? err) }));
  return true;
});

async function snapshot() {
  const store = await chrome.storage.local.get(["config", "status", "scans"]);
  return {
    version: VERSION,
    config: store.config ?? null,
    status: store.status ?? null,
    scans: store.scans ?? {},
  };
}

async function setStatus(text) {
  await chrome.storage.local.set({ status: { text, at: Date.now() } });
}

/** What the app says right now. Null when not signed in or unreachable. */
async function fetchConfig() {
  try {
    const res = await fetch(`${API}/config?v=${encodeURIComponent(VERSION)}`, { credentials: "include", cache: "no-store" });
    if (res.status === 401) {
      await setStatus("Not signed in to the app. Open it and sign in, then this carries on.");
      return null;
    }
    if (!res.ok) {
      await setStatus(`The app answered ${res.status}. Trying again next minute.`);
      return null;
    }
    const config = await res.json();
    await chrome.storage.local.set({ config, configAt: Date.now() });
    return config;
  } catch (err) {
    await setStatus(`Couldn't reach the app: ${err?.message ?? err}`);
    return null;
  }
}

/** The recipe the app sent, or the last one it sent, or nothing usable. */
function recipeOf(config) {
  return config?.recipe && config.recipe.scan && config.recipe.pacing ? config.recipe : null;
}

/**
 * Everything there is to look at, in the order it is due.
 *
 * The feed every scan interval; each search phrase every two, since search
 * moves slower and there are several; each listed group every interval.
 */
function scanTargets(settings, scans, force) {
  const every = (settings.scanEveryMinutes ?? 30) * 60 * 1000;
  const sources = settings.sources ?? { feed: true, search: true, list: true };
  const targets = [];
  if (sources.feed !== false) {
    targets.push({ key: "feed", source: "feed", url: settings.feedUrl || "https://www.facebook.com/groups/feed/", name: "your groups feed", every });
  }
  if (sources.search !== false) {
    for (const s of settings.searches ?? []) {
      targets.push({ key: `search:${s.phrase}`, source: "search", url: s.url, name: `search for "${s.phrase}"`, phrase: s.phrase, every: every * 2 });
    }
  }
  if (sources.list !== false) {
    for (const g of settings.groups ?? []) {
      targets.push({ key: g.url, source: "group", url: g.url, name: g.name || g.url, groupUrl: g.url, groupName: g.name, every });
    }
  }
  return targets
    .map((t) => ({ ...t, last: scans[t.key] ?? 0 }))
    .filter((t) => force || Date.now() - t.last >= t.every)
    .sort((a, b) => a.last - b.last);
}

async function tick(options = {}) {
  const store = await chrome.storage.local.get(["lock", "scans"]);
  if (!options.force && store.lock && Date.now() - store.lock < LOCK_MS) return;
  await chrome.storage.local.set({ lock: Date.now() });
  try {
    const config = await fetchConfig();
    if (!config) return;
    const recipe = recipeOf(config);
    if (!recipe) {
      await setStatus("The app didn't send the page recipe. It may be mid-deploy; trying again next minute.");
      return;
    }

    // Posts waiting for the team, said once each time the number grows,
    // so whoever runs the finder knows there is answering to do.
    const toAnswer = config.counts?.toAnswer ?? 0;
    const noticed = (await chrome.storage.local.get("noticedToAnswer")).noticedToAnswer ?? 0;
    if (toAnswer > noticed) {
      chrome.notifications.create("to-answer", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "People asking for work",
        message: `${toAnswer} post${toAnswer === 1 ? "" : "s"} waiting on the Posts to answer board. Click to open it.`,
      });
    }
    await chrome.storage.local.set({ noticedToAnswer: toAnswer });

    if (!config.active && config.because === "paused") {
      await setStatus(`Paused. ${config.pauseReason ?? ""}`.trim());
      return;
    }
    if (!config.active && config.because === "outside hours") {
      await setStatus(`Outside looking hours (${config.settings.activeFrom}–${config.settings.activeTo}). Looking again later.`);
      return;
    }

    // Otherwise, whichever page is most overdue a look.
    const scans = store.scans ?? {};
    const targets = scanTargets(config.settings, scans, options.force);
    const next = targets[0];
    if (!next) {
      await setStatus("Nothing due. Looking again soon.");
      return;
    }

    await setStatus(`Looking at ${next.name}…`);
    // Posts it has already asked the Share menu about, by their opening
    // words, so the same post is not opened again on every look.
    const asked = (await chrome.storage.local.get("sharedAsked")).sharedAsked ?? [];
    const found = await scanPage(next, config.settings.keywords ?? [], recipe, asked);
    if (found?.askedNow?.length) {
      await chrome.storage.local.set({ sharedAsked: [...asked, ...found.askedNow].slice(-600) });
    }
    scans[next.key] = Date.now();
    await chrome.storage.local.set({ scans });
    if (!found) return;

    // Sent even when nothing matched: the app keeps what the page looked
    // like, so a look that found nothing can be diagnosed from the app.
    const answer = await sendCandidates(next, found);
    if (!answer) return;
    const stats = found.stats ?? {};
    await setStatus(
      `${next.name}: read ${stats.posts ?? 0} posts, ${answer.kept ?? 0} new` +
        ((answer.skipped ?? 0) > 0 ? `, ${answer.skipped} seen before` : "") +
        ((answer.businesses ?? 0) > 0 ? `, ${answer.businesses} businesses saved` : "") +
        ". The ones asking for work are on the board."
    );
  } finally {
    await chrome.storage.local.set({ lock: 0 });
  }
}

async function sendCandidates(target, found) {
  try {
    const res = await fetch(`${API}/candidates`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: target.source,
        phrase: target.phrase ?? null,
        groupUrl: target.groupUrl ?? null,
        groupName: target.groupName || found.group || null,
        posts: found.posts,
        look: { name: target.name, source: target.source, stats: found.stats ?? null, version: VERSION },
      }),
    });
    if (!res.ok) {
      await setStatus(`The app couldn't take the posts (${res.status}).`);
      return null;
    }
    return await res.json();
  } catch (err) {
    await setStatus(`Couldn't send the posts: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Open a page in its own small window, wait for it, run something in it,
 * close it.
 *
 * Not a background tab: Chrome does not draw a tab you are not looking at,
 * and Facebook only loads the feed into a page that is being drawn, so a
 * background tab scrolled through an empty shell and found nothing. A
 * window of its own, off to the side and never given focus, is drawn and
 * loads, and goes away when the look is done.
 */
// `world` is where the function runs. "MAIN" is the page's own JavaScript,
// which the scan needs so it can catch the link Facebook copies when its
// "Copy link" is pressed. Posting stays in the extension's own world.
async function inTab(url, func, args, settleMs, loadTimeoutMs, world) {
  const bounds = await windowBounds();
  const win = await chrome.windows.create({ url, type: "popup", focused: false, ...bounds });
  const tab = win.tabs && win.tabs[0];
  if (!tab) {
    try {
      await chrome.windows.remove(win.id);
    } catch {
      // Already gone.
    }
    throw new Error("Couldn't open a window for the page.");
  }
  try {
    await waitForLoad(tab.id, loadTimeoutMs ?? 30000);
    await sleep(settleMs);
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args, ...(world ? { world } : {}) });
    return result?.result ?? null;
  } finally {
    try {
      await chrome.windows.remove(win.id);
    } catch {
      // Already gone.
    }
  }
}

/** A desktop-sized window tucked to the right of the one you are using. */
async function windowBounds() {
  const width = 1100;
  const height = 900;
  try {
    const current = await chrome.windows.getLastFocused();
    const left = Math.max(0, (current.left ?? 0) + (current.width ?? width) - width);
    const top = Math.max(0, current.top ?? 0);
    return { width, height, left, top };
  } catch {
    return { width, height };
  }
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") done();
    }
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scanPage(target, keywords, recipe, asked = []) {
  try {
    const settle = target.source === "search" ? recipe.scan.searchSettleMs : recipe.scan.settleMs;
    return await inTab(target.url, scanPosts, [keywords, recipe.scan, asked], settle, recipe.pacing.tabLoadTimeoutMs, "MAIN");
  } catch (err) {
    await setStatus(`Couldn't look at ${target.name}: ${err?.message ?? err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// What runs inside a Facebook page. It is self-contained: it
// is copied into the page by name, so nothing outside it exists there. Every
// selector and wait they use arrives in the recipe.
// ---------------------------------------------------------------------------

/**
 * On a feed, a search, or a group page: the posts on the first few screens
 * that mention the work, each with who posted it and which group it is in.
 */
async function scanPosts(keywords, r, asked) {
  const askedBefore = new Set(asked || []);
  const askedNow = [];
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const clean = (s) => (s || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const re = (p) => new RegExp(p, "i");
  const seeMore = re(r.seeMoreText);
  const postLink = re(r.postLink);
  const groupLink = re(r.groupLink);
  const notGroupLink = re(r.notGroupLink);
  const profileLink = re(r.profileLink);
  const anonymousRe = re(r.anonymous);
  const isGroupLink = (href) => groupLink.test(href) && !notGroupLink.test(href);
  const mentionsWork = (text) => {
    const low = text.toLowerCase();
    return keywords.some((word) => word && low.includes(String(word).toLowerCase()));
  };

  // Facebook fills in a post's real link only when the pointer passes over
  // it: until then the time stamp that carries it points at "#". Only those
  // unfilled links are hovered. Hovering a name or a group opens its card,
  // which is what looked like it was clicking on people's accounts.
  const unfilled = (a) => {
    const href = a.getAttribute("href");
    return !href || href === "#" || href.startsWith("#") || /^javascript:/i.test(href);
  };
  const reveal = (el) => {
    for (const a of el.querySelectorAll("a")) {
      if (!unfilled(a)) continue;
      const init = { bubbles: true, cancelable: true, view: window, relatedTarget: document.body };
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
        a.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
      }
      a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      for (const type of ["pointerout", "pointerleave", "mouseout", "mouseleave"]) {
        a.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
      }
    }
  };
  // Facebook scatters the letters of "Facebook" through a post's time stamp
  // so it cannot be read off the page. Those lines, and one- and two-letter
  // lines, come out.
  const tidy = (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 2 && !/^facebook$/i.test(line))
      .join("\n");
  const expand = () => {
    for (const button of document.querySelectorAll('div[role="button"]')) {
      if (seeMore.test((button.innerText || "").trim())) {
        try {
          button.click();
        } catch {
          // Nothing to expand.
        }
      }
    }
  };
  // A post is the outermost box of its kind: comments are boxes too, nested
  // in the post they answer.
  const outermost = () =>
    Array.from(document.querySelectorAll(r.article)).filter((el) => !(el.parentElement && el.parentElement.closest(r.article)));

  const textOf = (post) => {
    const body = post.querySelector(r.messageBody);
    let text = body ? body.innerText : "";
    if (!text) {
      text = (post.innerText || "")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(2)
        .join("\n");
    }
    return clean(tidy(text)).slice(0, r.maxTextChars ?? 3000);
  };

  // Read as it scrolls, not after. Facebook takes posts that have scrolled
  // well out of view back off the page, so a read at the end only ever saw
  // the last screen or two.
  const done = new WeakSet();
  const tries = new WeakMap();
  const byUrl = new Map();
  const stats = { posts: 0, withText: 0, mentioned: 0, mentionedNoLink: 0, withLink: 0, shared: 0, samples: [] };

  // Catch what Facebook copies. Pressing "Copy link" makes the page write
  // the post's link to the clipboard; the write is caught here instead, so
  // the link is read without touching what is on your own clipboard.
  const grab = { text: null };
  try {
    const board = navigator.clipboard;
    if (board) {
      board.writeText = async (text) => {
        grab.text = String(text);
      };
      board.write = async (items) => {
        try {
          for (const item of items) {
            if (item.types.includes("text/plain")) grab.text = await (await item.getType("text/plain")).text();
          }
        } catch {
          // Not text.
        }
      };
    }
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (type, data) {
      if (/text/i.test(type)) grab.text = String(data);
      return setData.call(this, type, data);
    };
  } catch {
    // The page would not let the clipboard be watched; posts go without links.
  }
  const shareRe = re(r.shareButton ?? "^share$");
  const copyRe = re(r.copyLinkText ?? "^copy link$");
  const labelOf = (el) => (el.getAttribute("aria-label") || el.innerText || "").trim();
  const escape = () => {
    for (const type of ["keydown", "keyup"]) {
      document.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    }
  };
  const isFacebookLink = (text) => /^https?:\/\/(www\.|m\.)?facebook\.com\/\S+$/i.test((text || "").trim());

  // A post with no link on the page: open its Share menu, press "Copy link",
  // and take the link Facebook copies. Nothing is shared; the menu is closed
  // straight after, and nothing but "Copy link" is ever pressed.
  const shareLink = async (box) => {
    const button = Array.from(box.querySelectorAll('[role="button"]')).find((el) => shareRe.test(labelOf(el)));
    if (!button) return null;
    grab.text = null;
    button.click();
    await sleep(r.shareMenuWaitMs ?? 1200);
    const item = Array.from(document.querySelectorAll('[role="menuitem"], [role="button"], [role="dialog"] span')).find(
      (el) => copyRe.test(labelOf(el)) && el.getBoundingClientRect().height > 0
    );
    if (item) {
      (item.closest('[role="menuitem"], [role="button"]') || item).click();
      await sleep(r.copyWaitMs ?? 700);
    }
    escape();
    await sleep(300);
    return isFacebookLink(grab.text) ? grab.text.trim() : null;
  };

  const readVisible = async () => {
    expand();
    const boxes = outermost().filter((el) => !done.has(el));
    for (const box of boxes) reveal(box);
    await sleep(r.revealWaitMs ?? 500);
    for (const box of boxes) {
      const text = textOf(box);
      // Not drawn yet: come back to it on the next pass.
      if (!text || text.length < 12) continue;
      const links = Array.from(box.querySelectorAll("a[href]"));
      const permalink = links.find((a) => postLink.test(a.href));
      const attempt = (tries.get(box) ?? 0) + 1;
      tries.set(box, attempt);
      // No link yet: one more hover on the next pass before giving up on it.
      if (!permalink && attempt < 2) continue;
      done.add(box);
      stats.posts += 1;
      stats.withText += 1;
      const matched = mentionsWork(text);
      // Still no link: ask the Share menu for one, for posts about the work.
      let url = permalink ? permalink.href : null;
      const opening = text.slice(0, 80);
      if (!url && matched && r.shareForLink !== false && stats.shared < (r.shareMax ?? 15) && !askedBefore.has(opening)) {
        url = await shareLink(box);
        askedNow.push(opening);
        askedBefore.add(opening);
        if (url) stats.shared += 1;
      }
      if (url) stats.withLink += 1;
      if (matched) stats.mentioned += 1;
      if (matched && !url) stats.mentionedNoLink += 1;
      if (stats.samples.length < 8) {
        stats.samples.push({ text: text.slice(0, 120), link: Boolean(url), matched });
      }
      // Every post read is sent, link or no link, words or no words: the
      // owner picks from all of them in the app. Only the model's own
      // answering needs a link and a match, and the app sorts that out.
      const key = url ?? `text:${text.slice(0, 200)}`;
      if (byUrl.has(key)) continue;

      const ageLabel = permalink ? (permalink.getAttribute("aria-label") || permalink.innerText || "").trim().slice(0, 40) : "";
      // The header: the group's name, then the poster's. On a group's own
      // page the group is the page, so the first named link is the poster.
      const gl = links.find((a) => isGroupLink(a.href) && (a.innerText || "").trim().length > 1);
      const group = gl ? { url: gl.href, name: clean(gl.innerText).slice(0, 120) } : null;
      const header = clean(box.innerText).split("\n").slice(0, 4).join(" ");
      const anonymous = anonymousRe.test(header);
      let author = "";
      if (!anonymous) {
        const profile = links.find(
          (a) => profileLink.test(a.href) && !isGroupLink(a.href) && (a.innerText || "").trim().length > 1 && (a.innerText || "").trim().length < 60
        );
        author = clean(profile ? profile.innerText : "");
        if (!author) {
          const strong = box.querySelector(r.authorFallback);
          const candidate = clean(strong ? strong.innerText : "");
          if (candidate && (!group || candidate !== group.name)) author = candidate;
        }
      }
      byUrl.set(key, { url, text, author: author.slice(0, 80), anonymous, ageLabel, group, matched });
    }
  };

  await readVisible();
  for (let i = 0; i < (r.scrollTimes ?? 3); i += 1) {
    window.scrollBy(0, Math.round(window.innerHeight * (r.scrollScreens ?? 0.9)));
    await sleep(r.scrollWaitMs ?? 1500);
    await readVisible();
  }

  const pageGroup = (document.title || "").split(/\s[|\-–—]\s/)[0].trim();
  return {
    group: pageGroup,
    posts: Array.from(byUrl.values()).slice(0, r.maxPosts ?? 25),
    askedNow,
    // What the page looked like, so a look that found nothing can say why.
    stats: { ...stats, articles: stats.posts, textChars: (document.body.innerText || "").length, title: pageGroup.slice(0, 80) },
  };
}

// ---------------------------------------------------------------------------
// The old button, kept: answer the post in front of you, by hand, in the app.
// ---------------------------------------------------------------------------

async function answerByHand(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  let captured = null;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capture });
    captured = result?.result ?? null;
  } catch (err) {
    console.warn("Could not read the page:", err);
  }
  const params = new URLSearchParams();
  if (captured?.text) params.set("text", captured.text.slice(0, 4000));
  if (captured?.group) params.set("group", captured.group.slice(0, 120));
  params.set("platform", platformOf(tab.url));
  await chrome.tabs.create({ url: `${APP}/admin/outreach?${params.toString()}` });
}

function platformOf(url) {
  const host = new URL(url).hostname;
  if (/facebook\.com$/.test(host)) return "facebook";
  if (/nextdoor\.com$/.test(host)) return "nextdoor";
  if (/instagram\.com$/.test(host)) return "instagram";
  if (/reddit\.com$/.test(host)) return "reddit";
  return "other";
}

// Runs inside the page. What you have selected wins; failing that, the post
// nearest the middle of the screen; failing that, nothing, and the form asks.
function capture() {
  const selected = (window.getSelection()?.toString() ?? "").trim();
  const clean = (s) => s.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  let group = "";
  const path = location.pathname;
  const sub = path.match(/^\/r\/([^/]+)/);
  if (sub) group = `r/${sub[1]}`;
  else {
    const title = (document.title || "").split(/\s[|\-–—]\s/)[0].trim();
    if (title && !/^facebook$|^nextdoor$|^log in/i.test(title)) group = title;
  }

  if (selected.length > 20) return { text: clean(selected), group };

  const middle = window.innerHeight / 2;
  const candidates = Array.from(document.querySelectorAll('[role="article"], article, shreddit-post, [data-testid="post-container"]'));
  let best = null;
  let bestDistance = Infinity;
  for (const el of candidates) {
    const box = el.getBoundingClientRect();
    if (box.height < 60 || box.bottom < 0 || box.top > window.innerHeight) continue;
    const distance = Math.abs((box.top + box.bottom) / 2 - middle);
    if (distance < bestDistance) {
      best = el;
      bestDistance = distance;
    }
  }
  const text = best ? clean(best.innerText || "") : "";
  return { text: text.slice(0, 4000), group };
}
