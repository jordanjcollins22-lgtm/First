// The button. One click on a page with a post on it, and the app opens with
// the post already on it. Nothing here scrolls, posts, or reads anything
// but the page you are looking at, and only when you press the button.
const APP = "https://app.jslandscapingmd.com/admin/outreach";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return;
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
  await chrome.tabs.create({ url: `${APP}?${params.toString()}` });
});

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

  // The group's name is in the title on Facebook and Nextdoor, ahead of the
  // separator; on Reddit it is the subreddit in the path.
  let group = "";
  const path = location.pathname;
  const sub = path.match(/^\/r\/([^/]+)/);
  if (sub) group = `r/${sub[1]}`;
  else {
    const title = (document.title || "").split(/\s[|\-–—]\s/)[0].trim();
    if (title && !/^facebook$|^nextdoor$|^log in/i.test(title)) group = title;
  }

  if (selected.length > 20) return { text: clean(selected), group };

  // The post nearest the middle of the viewport, by the boxes the page
  // marks as posts. Nothing is scrolled to find it.
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
