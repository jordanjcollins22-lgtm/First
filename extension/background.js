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
const STALE_QUEUE_MS = 12 * 60 * 60 * 1000;
const LOCK_MS = 3 * 60 * 1000;

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
    const res = await fetch(`${API}/config`, { credentials: "include", cache: "no-store" });
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

    // Anything the app wrote that has sat here half a day is not going up
    // now: the neighbour has found somebody. Told so the board stops
    // showing it as waiting.
    let queue = (store.queue ?? []).filter((item) => item.post);
    const stale = queue.filter((item) => Date.now() - item.addedAt > STALE_QUEUE_MS);
    for (const item of stale) await report(item, { ok: false, error: "Not posted within twelve hours, so left alone." });
    queue = queue.filter((item) => !stale.includes(item));
    await chrome.storage.local.set({ queue });

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
      const outcome = await postOne(item);
      await report(item, outcome);
      const rest = queue.slice(1);
      await chrome.storage.local.set({
        queue: rest,
        nextPostAt: Date.now() + delayMs(),
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
    const found = await scanPage(next, config.settings.keywords ?? []);
    scans[next.key] = Date.now();
    await chrome.storage.local.set({ scans });
    if (!found) return;

    const answer = await sendCandidates(next, found);
    if (!answer) return;
    const actions = (answer.actions ?? []).map((action) => ({ ...action, groupName: action.groupName ?? next.groupName ?? null, addedAt: Date.now() }));
    const toPost = actions.filter((action) => action.post);
    const toPaste = actions.filter((action) => !action.post);
    if (toPost.length > 0) {
      const current = (await chrome.storage.local.get("queue")).queue ?? [];
      await chrome.storage.local.set({ queue: [...current, ...toPost] });
    }
    if (toPaste.length > 0) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Comments ready to paste",
        message: `${toPaste.length} written from ${next.name}. They are on the Link Tracking board.`,
      });
    }
    const notMember = (answer.decided ?? []).filter((d) => d.decision === "not_member").length;
    await setStatus(
      `${next.name}: ${found.posts.length} post${found.posts.length === 1 ? "" : "s"} mentioned the work, ${actions.length} worth answering` +
        (notMember > 0 ? `, ${notMember} in groups you haven't joined` : "") +
        `, ${answer.skipped ?? 0} seen before.`
    );
  } finally {
    await chrome.storage.local.set({ lock: 0 });
  }
}

function delayMs() {
  return (90 + Math.floor(Math.random() * 210)) * 1000;
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

/** Open a page in the background, wait for it, run something in it, close it. */
async function inTab(url, func, args, settleMs) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id, 30000);
    await sleep(settleMs);
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    return result?.result ?? null;
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // Already gone.
    }
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

async function scanPage(target, keywords) {
  try {
    return await inTab(target.url, scanPosts, [keywords], target.source === "search" ? 6000 : 4000);
  } catch (err) {
    await setStatus(`Couldn't look at ${target.name}: ${err?.message ?? err}`);
    return null;
  }
}

async function postOne(item) {
  try {
    const result = await inTab(item.url, postComment, [item.comment, item.code, item.mention ?? null], 5000);
    return result ?? { ok: false, error: "The page gave nothing back." };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// The two things that run inside a Facebook page. Each is self-contained: it
// is copied into the page by name, so nothing outside it exists there.
// ---------------------------------------------------------------------------

/**
 * On a feed, a search, or a group page: the posts on the first few screens
 * that mention the work, each with who posted it and which group it is in.
 */
async function scanPosts(keywords) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  for (let i = 0; i < 3; i += 1) {
    window.scrollBy(0, window.innerHeight * 2);
    await sleep(1500);
  }
  for (const button of document.querySelectorAll('div[role="button"]')) {
    if (/^see more$/i.test((button.innerText || "").trim())) {
      try {
        button.click();
      } catch {
        // Nothing to expand.
      }
    }
  }
  await sleep(800);

  const isPostLink = (href) => /\/groups\/[^/]+\/(posts|permalink)\/|story_fbid=|multi_permalinks=/.test(href);
  const isGroupLink = (href) => /\/groups\/[^/?#]+\/?(\?|#|$)/.test(href) && !/\/groups\/(feed|discover|joins)\b/.test(href);
  const isProfileLink = (href) =>
    /\/groups\/[^/]+\/user\/\d+/.test(href) || /\/profile\.php\?id=\d+/.test(href) || /^https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9.]+\/?(\?|$)/.test(href);

  // A post is an article that is not inside another article: comments are
  // articles too, nested in the post they answer.
  const articles = Array.from(document.querySelectorAll('[role="article"]')).filter(
    (el) => !(el.parentElement && el.parentElement.closest('[role="article"]'))
  );
  const posts = [];
  for (const article of articles) {
    const links = Array.from(article.querySelectorAll("a[href]"));
    const permalink = links.find((a) => isPostLink(a.href));
    if (!permalink) continue;
    const ageLabel = (permalink.getAttribute("aria-label") || permalink.innerText || "").trim().slice(0, 40);

    // The header: the group's name, then the poster's. On a group's own
    // page the group is the page, so the first named link is the poster.
    const groupLink = links.find((a) => isGroupLink(a.href) && (a.innerText || "").trim().length > 1);
    const group = groupLink ? { url: groupLink.href, name: clean(groupLink.innerText).slice(0, 120) } : null;
    const header = clean(article.innerText).split("\n").slice(0, 4).join(" ");
    const anonymous = /anonymous (participant|member)/i.test(header);
    let author = "";
    if (!anonymous) {
      const profile = links.find((a) => isProfileLink(a.href) && !isGroupLink(a.href) && (a.innerText || "").trim().length > 1 && (a.innerText || "").trim().length < 60);
      author = clean(profile ? profile.innerText : "");
      if (!author) {
        const strong = article.querySelector("h2 strong, h3 strong, h4 strong, strong a, strong");
        const candidate = clean(strong ? strong.innerText : "");
        if (candidate && (!group || candidate !== group.name)) author = candidate;
      }
    }

    const body = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    let text = body ? body.innerText : "";
    if (!text) {
      text = (article.innerText || "")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(2)
        .join("\n");
    }
    text = clean(text).slice(0, 3000);
    if (!text) continue;
    const low = text.toLowerCase();
    if (!keywords.some((word) => word && low.includes(String(word).toLowerCase()))) continue;
    posts.push({ url: permalink.href, text, author: author.slice(0, 80), anonymous, ageLabel, group });
  }
  const pageGroup = (document.title || "").split(/\s[|\-–—]\s/)[0].trim();
  return { group: pageGroup, posts: posts.slice(0, 25) };
}

/**
 * On a post's own page: mention the poster, put the comment in the box and
 * send it. A page with a "Join group" button and no box is a group the
 * account is not in, and says so rather than failing.
 */
async function postComment(text, code, mention) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dialogText = () => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog ? (dialog.innerText || "").trim() : "";
  };
  const looksBlocked = (s) => /temporarily blocked|action blocked|can'?t use this feature|you.re blocked|going too fast|restricted from/i.test(s);
  const findBox = () => {
    const boxes = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"]'));
    const visible = boxes.filter((el) => el.getBoundingClientRect().height > 0);
    return (
      visible.find((el) => /comment/i.test(el.getAttribute("aria-label") || "") || /comment/i.test(el.getAttribute("aria-placeholder") || "")) ||
      visible[0] ||
      null
    );
  };
  const joinButton = () =>
    Array.from(document.querySelectorAll('[role="button"], a[role="link"]')).find((el) => /^(join group|join|request to join)$/i.test((el.innerText || el.getAttribute("aria-label") || "").trim()));
  const onPage = () => {
    const box = findBox();
    const inBox = box ? (box.innerText || "").includes(code) : false;
    return (document.body.innerText || "").includes(code) && !inBox;
  };

  const already = dialogText();
  if (already && looksBlocked(already)) return { ok: false, error: already.slice(0, 300) };
  if (onPage()) return { ok: true, posted: text, note: "It was already there." };

  let box = findBox();
  if (!box) {
    const opener = Array.from(document.querySelectorAll('[role="button"]')).find((el) => {
      const label = (el.getAttribute("aria-label") || el.innerText || "").trim();
      return /^(leave a )?comment$/i.test(label) || /^write a comment/i.test(label);
    });
    if (opener) {
      opener.click();
      await sleep(1500);
      box = findBox();
    }
  }
  if (!box) {
    if (joinButton()) return { ok: false, notMember: true, error: "Not a member of this group." };
    return { ok: false, error: `No comment box on this post.${already ? ` The page says: ${already.slice(0, 200)}` : ""}` };
  }

  box.scrollIntoView({ block: "center" });
  box.focus();
  await sleep(500);

  // The mention first: "@Name" typed, the picker given a moment, the poster
  // picked from it. If no picker comes, the typed name stays as plain text,
  // which still reads right.
  let rest = text;
  if (mention) {
    const prefix = new RegExp(`^@${mention.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*`, "i");
    rest = text.replace(prefix, "");
    document.execCommand("insertText", false, `@${mention}`);
    await sleep(1800);
    const options = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]')).filter(
      (el) => el.getBoundingClientRect().height > 0
    );
    const pick = options.find((el) => (el.innerText || "").toLowerCase().includes(mention.toLowerCase())) || options[0];
    if (pick) {
      pick.click();
      await sleep(600);
      document.execCommand("insertText", false, " ");
    } else {
      document.execCommand("insertText", false, " ");
    }
    await sleep(300);
  }
  document.execCommand("insertText", false, rest);
  await sleep(800);
  const head = rest.slice(0, 30);
  if (!(box.innerText || "").includes(head)) {
    const data = new DataTransfer();
    data.setData("text/plain", rest);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await sleep(800);
  }
  if (!(box.innerText || "").includes(head)) return { ok: false, error: "Couldn't type into the comment box." };

  await sleep(1200 + Math.floor(Math.random() * 1500));
  for (const type of ["keydown", "keypress", "keyup"]) {
    box.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }
  await sleep(2500);
  if (!onPage()) {
    const submit = document.querySelector('[aria-label="Comment"][role="button"], [aria-label="Post"][role="button"], [aria-label="Submit"][role="button"]');
    if (submit) {
      submit.click();
      await sleep(2500);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    if (onPage()) return { ok: true, posted: text };
    const dialog = dialogText();
    if (dialog && looksBlocked(dialog)) return { ok: false, error: dialog.slice(0, 300) };
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
