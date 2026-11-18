// The lead finder's background worker.
//
// Two jobs: open the side panel when the toolbar button is pressed, and carry
// calls to the app. Calls go from here (not from the Facebook page) so they
// use the app's own sign-in cookie in this Chrome and are not blocked as
// cross-site requests. Nothing here talks to Facebook.

const APP = "https://app.jslandscapingmd.com";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function api(method, body) {
  try {
    const response = await fetch(`${APP}/api/extension`, {
      method,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 401) return { ok: false, signedOut: true, error: json.error || "Sign in to the app in this Chrome first." };
    if (!response.ok && json.ok !== false) return { ok: false, error: `The app answered ${response.status}.` };
    return json;
  } catch {
    return { ok: false, error: "Couldn't reach the app. Check the internet connection." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "api") {
    api(message.method || "POST", message.body).then(reply);
    return true;
  }
  if (message?.type === "am-i-the-finder") {
    chrome.storage.local.get("run").then(({ run }) => {
      reply({ yes: Boolean(run?.on && sender.tab && run.tabId === sender.tab.id) });
    });
    return true;
  }
  if (message?.type === "open") {
    chrome.tabs.create({ url: message.url });
    return false;
  }
  return false;
});

// The Facebook tab it was working in was closed: stop, so it doesn't look
// like it is still running.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { run } = await chrome.storage.local.get("run");
  if (run?.on && run.tabId === tabId) {
    await chrome.storage.local.set({ run: { ...run, on: false, state: "stopped", note: "Stopped: the Facebook tab was closed." } });
  }
});
