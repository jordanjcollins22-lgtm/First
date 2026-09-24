// The group agent, in the browser.
//
// Once a minute an alarm fires and one small thing happens: a comment that
// is due goes up, or one page gets looked at. Never both, never more than
// one, so the browser is doing about what a person would be doing in the
// same chair, only without forgetting. Everything that decides whether a
// comment may go up — the sources, the caps, the hours, the pause — is
// asked of the app each minute, so the only thing kept here is the queue
// of comments the app has written and not yet posted.
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
    } else if (message?.type === "post-now") {
      await chrome.storage.local.set({ nextPostAt: 0 });
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
  const store = await chrome.storage.local.get(["config", "queue", "nextPostAt", "status", "scans"]);
  return {
    version: VERSION,
    config: store.config ?? null,
    queue: (store.queue ?? []).length,
    nextPostAt: store.nextPostAt ?? 0,
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

/** The comments the app says to post, oldest first. Empty when it cannot be reached. */
async function fetchQueue() {
  try {
    const res = await fetch(`${API}/queue`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.queue ?? []).map((item) => ({ ...item, post: true }));
  } catch {
    return [];
  }
}

/** The recipe the app sent, or the last one it sent, or nothing usable. */
function recipeOf(config) {
  return config?.recipe && config.recipe.scan && config.recipe.post && config.recipe.pacing ? config.recipe : null;
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
  const store = await chrome.storage.local.get(["lock", "queue", "nextPostAt", "scans"]);
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

    // The app holds the queue: everything approved and not yet posted,
    // whether approved by hand on a phone or straight away because the
    // owner said to post without asking. Read fresh each minute, so a
    // comment approved anywhere is posted here.
    const queue = await fetchQueue();
    await chrome.storage.local.set({ queue });

    const toReview = config.counts?.toReview ?? 0;
    const seenReview = (await chrome.storage.local.get("noticedReview")).noticedReview ?? 0;
    if (toReview > 0 && toReview !== seenReview) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Comments waiting for your OK",
        message: `${toReview} written and waiting. Open the Group Agent page in the app to approve or decline.`,
      });
    }
    await chrome.storage.local.set({ noticedReview: toReview });

    const paused = !config.active && config.because === "paused";
    if (paused) {
      await setStatus(`Paused. ${config.pauseReason ?? ""}`.trim());
      return;
    }
    const outsideHours = !config.active && config.because === "outside hours";

    // A comment first, when one is due and the app says the way is clear.
    const due = Date.now() >= (store.nextPostAt ?? 0);
    if (queue.length > 0 && config.active && (due || options.force)) {
      const item = queue[0];
      await setStatus(`Posting in ${item.groupName ?? "a group"}…`);
      const outcome = await postOne(item, recipe);
      await report(item, outcome);
      const rest = queue.slice(1);
      await chrome.storage.local.set({
        queue: rest,
        nextPostAt: Date.now() + delayMs(recipe),
      });
      await setStatus(
        outcome.ok
          ? `Posted in ${item.groupName ?? "a group"}. ${rest.length} waiting.`
          : outcome.notMember
            ? `Not a member of ${item.groupName ?? "that group"}; it's on the groups-to-join list.`
            : `Couldn't post: ${outcome.error}`
      );
      return;
    }

    if (outsideHours) {
      await setStatus(`Outside posting hours (${config.settings.activeFrom}–${config.settings.activeTo}). Looking again later.`);
      return;
    }

    // Otherwise, whichever page is most overdue a look.
    const scans = store.scans ?? {};
    const targets = scanTargets(config.settings, scans, options.force);
    const next = targets[0];
    if (!next) {
      if (queue.length > 0 && !config.active) await setStatus(`${queue.length} waiting: ${config.because}.`);
      else if (queue.length > 0) await setStatus(`${queue.length} waiting. Next one in about ${Math.max(1, Math.round(((store.nextPostAt ?? 0) - Date.now()) / 60000))} min.`);
      else await setStatus("Nothing new. Looking again soon.");
      return;
    }

    await setStatus(`Looking at ${next.name}…`);
    const found = await scanPage(next, config.settings.keywords ?? [], recipe);
    scans[next.key] = Date.now();
    await chrome.storage.local.set({ scans });
    if (!found) return;

    // Sent even when nothing matched: the app keeps what the page looked
    // like, so a look that found nothing can be diagnosed from the app.
    const answer = await sendCandidates(next, found);
    if (!answer) return;
    const stats = found.stats ?? {};
    if (found.posts.length === 0) {
      await setStatus(
        `${next.name}: read ${stats.posts ?? 0} posts, ${stats.mentioned ?? 0} mentioned the work` +
          ((stats.mentionedNoLink ?? 0) > 0 ? ` but ${stats.mentionedNoLink} had no link to open` : "") +
          "." +
          ((stats.posts ?? 0) === 0 ? ` The page may not have loaded (title "${found.group || ""}", ${stats.textChars ?? 0} characters of text).` : "")
      );
      return;
    }
    // The app keeps what it wrote: posted straight away or held for a yes,
    // depending on the setting. Either way it comes back through the queue.
    const actions = answer.actions ?? [];
    const held = actions.filter((action) => !action.post).length;
    const notMember = (answer.decided ?? []).filter((d) => d.decision === "not_member").length;
    await setStatus(
      `${next.name}: read ${stats.posts ?? "?"} posts, ${found.posts.length} mentioned the work, ${actions.length} worth answering` +
        (held > 0 ? ` (${held} waiting for your OK in the app)` : "") +
        (notMember > 0 ? `, ${notMember} in groups you haven't joined` : "") +
        `, ${answer.skipped ?? 0} seen before.`
    );
  } finally {
    await chrome.storage.local.set({ lock: 0 });
  }
}

function delayMs(recipe) {
  const min = recipe.pacing.minDelaySeconds ?? 90;
  const max = recipe.pacing.maxDelaySeconds ?? 300;
  return (min + Math.floor(Math.random() * Math.max(1, max - min))) * 1000;
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

async function report(item, outcome) {
  try {
    await fetch(`${API}/posted`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seenId: item.seenId,
        linkId: item.linkId,
        ok: Boolean(outcome.ok),
        postedText: outcome.ok ? outcome.posted ?? item.comment : undefined,
        error: outcome.ok ? undefined : outcome.error,
        notMember: Boolean(outcome.notMember),
        postUrl: item.url,
        groupName: item.groupName ?? null,
      }),
    });
  } catch (err) {
    console.warn("Couldn't report:", err);
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
async function inTab(url, func, args, settleMs, loadTimeoutMs) {
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
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
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

async function scanPage(target, keywords, recipe) {
  try {
    const settle = target.source === "search" ? recipe.scan.searchSettleMs : recipe.scan.settleMs;
    return await inTab(target.url, scanPosts, [keywords, recipe.scan], settle, recipe.pacing.tabLoadTimeoutMs);
  } catch (err) {
    await setStatus(`Couldn't look at ${target.name}: ${err?.message ?? err}`);
    return null;
  }
}

async function postOne(item, recipe) {
  try {
    const result = await inTab(item.url, postComment, [item.comment, item.code, item.mention ?? null, recipe.post], recipe.post.settleMs, recipe.pacing.tabLoadTimeoutMs);
    return result ?? { ok: false, error: "The page gave nothing back." };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// The two things that run inside a Facebook page. Each is self-contained: it
// is copied into the page by name, so nothing outside it exists there. Every
// selector and wait they use arrives in the recipe.
// ---------------------------------------------------------------------------

/**
 * On a feed, a search, or a group page: the posts on the first few screens
 * that mention the work, each with who posted it and which group it is in.
 */
async function scanPosts(keywords, r) {
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
  // it: until then the time stamp that carries it points at "#". So every
  // link in a post is given a hover before it is read.
  const reveal = (el) => {
    for (const a of el.querySelectorAll("a")) {
      for (const type of ["mouseover", "mouseenter", "mousemove"]) {
        a.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      a.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    }
  };
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
    return clean(text).slice(0, r.maxTextChars ?? 3000);
  };

  // Read as it scrolls, not after. Facebook takes posts that have scrolled
  // well out of view back off the page, so a read at the end only ever saw
  // the last screen or two.
  const done = new WeakSet();
  const tries = new WeakMap();
  const byUrl = new Map();
  const stats = { posts: 0, withText: 0, mentioned: 0, mentionedNoLink: 0, withLink: 0, samples: [] };

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
      if (permalink) stats.withLink += 1;
      if (matched) stats.mentioned += 1;
      if (matched && !permalink) stats.mentionedNoLink += 1;
      if (stats.samples.length < 8) {
        stats.samples.push({ text: text.slice(0, 120), link: Boolean(permalink), matched });
      }
      if (!matched || !permalink) continue;

      const ageLabel = (permalink.getAttribute("aria-label") || permalink.innerText || "").trim().slice(0, 40);
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
      if (!byUrl.has(permalink.href)) {
        byUrl.set(permalink.href, { url: permalink.href, text, author: author.slice(0, 80), anonymous, ageLabel, group });
      }
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
    // What the page looked like, so a look that found nothing can say why.
    stats: { ...stats, articles: stats.posts, textChars: (document.body.innerText || "").length, title: pageGroup.slice(0, 80) },
  };
}

/**
 * On a post's own page: mention the poster, put the comment in the box and
 * send it. A page with a "Join group" button and no box is a group the
 * account is not in, and says so rather than failing.
 */
async function postComment(text, code, mention, r) {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const re = (p) => new RegExp(p, "i");
  const boxLabel = re(r.commentBoxLabel);
  const openLabel = re(r.openCommentLabel);
  const joinLabel = re(r.joinButton);
  const blockedRe = re(r.blocked);
  const dialogText = () => {
    const dialog = document.querySelector(r.dialog);
    return dialog ? (dialog.innerText || "").trim() : "";
  };
  const findBox = () => {
    const boxes = Array.from(document.querySelectorAll(r.commentBox));
    const visible = boxes.filter((el) => el.getBoundingClientRect().height > 0);
    return visible.find((el) => boxLabel.test(el.getAttribute("aria-label") || "") || boxLabel.test(el.getAttribute("aria-placeholder") || "")) || visible[0] || null;
  };
  const joinButton = () =>
    Array.from(document.querySelectorAll('[role="button"], a[role="link"]')).find((el) => joinLabel.test((el.innerText || el.getAttribute("aria-label") || "").trim()));
  const onPage = () => {
    const box = findBox();
    const inBox = box ? (box.innerText || "").includes(code) : false;
    return (document.body.innerText || "").includes(code) && !inBox;
  };

  const already = dialogText();
  if (already && blockedRe.test(already)) return { ok: false, error: already.slice(0, 300) };
  if (onPage()) return { ok: true, posted: text, note: "It was already there." };

  let box = findBox();
  if (!box) {
    const opener = Array.from(document.querySelectorAll('[role="button"]')).find((el) => openLabel.test((el.getAttribute("aria-label") || el.innerText || "").trim()));
    if (opener) {
      opener.click();
      await sleep(r.afterOpenMs ?? 1500);
      box = findBox();
    }
  }
  if (!box) {
    if (joinButton()) return { ok: false, notMember: true, error: "Not a member of this group." };
    return { ok: false, error: `No comment box on this post.${already ? ` The page says: ${already.slice(0, 200)}` : ""}` };
  }

  box.scrollIntoView({ block: "center" });
  box.focus();
  await sleep(r.afterFocusMs ?? 500);

  // The mention first: "@Name" typed, the picker given a moment, the poster
  // picked from it. If no picker comes, the typed name stays as plain text,
  // which still reads right.
  let rest = text;
  if (mention) {
    const prefix = new RegExp(`^@${mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i");
    rest = text.replace(prefix, "");
    document.execCommand("insertText", false, `@${mention}`);
    await sleep(r.mentionWaitMs ?? 1800);
    const options = Array.from(document.querySelectorAll(r.mentionOption)).filter((el) => el.getBoundingClientRect().height > 0);
    const pick = options.find((el) => (el.innerText || "").toLowerCase().includes(mention.toLowerCase())) || options[0];
    if (pick) {
      pick.click();
      await sleep(600);
    }
    document.execCommand("insertText", false, " ");
    await sleep(300);
  }
  document.execCommand("insertText", false, rest);
  await sleep(r.afterTypeMs ?? 800);
  const head = rest.slice(0, 30);
  if (!(box.innerText || "").includes(head)) {
    const data = new DataTransfer();
    data.setData("text/plain", rest);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await sleep(r.afterTypeMs ?? 800);
  }
  if (!(box.innerText || "").includes(head)) return { ok: false, error: "Couldn't type into the comment box." };

  await sleep((r.beforeSendMinMs ?? 1200) + Math.floor(Math.random() * (r.beforeSendJitterMs ?? 1500)));
  for (const type of ["keydown", "keypress", "keyup"]) {
    box.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }
  await sleep(r.afterSendMs ?? 2500);
  if (!onPage()) {
    const submit = document.querySelector(r.submitButton);
    if (submit) {
      submit.click();
      await sleep(r.afterSendMs ?? 2500);
    }
  }
  for (let i = 0; i < (r.verifyTries ?? 8); i += 1) {
    if (onPage()) return { ok: true, posted: text };
    const dialog = dialogText();
    if (dialog && blockedRe.test(dialog)) return { ok: false, error: dialog.slice(0, 300) };
    await sleep(1000);
  }
  const dialog = dialogText();
  return { ok: false, error: `The comment didn't appear after sending.${dialog ? ` The page says: ${dialog.slice(0, 200)}` : ""}` };
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
