// The popup: the on and off switch, what the finder is doing, how many
// posts are waiting for the team, and a word when the app wants a newer copy.
const APP = "https://app.jslandscapingmd.com";
document.getElementById("settings").href = `${APP}/admin/outreach/agent`;

function render(snap) {
  const status = document.getElementById("status");
  const counts = document.getElementById("counts");
  const update = document.getElementById("update");
  const version = document.getElementById("version");
  if (!snap || snap.error) {
    status.textContent = snap?.error ? `Something went wrong: ${snap.error}` : "Not running yet.";
    return;
  }
  version.textContent = `v${snap.version ?? "?"}`;
  const config = snap.config;
  const lines = [];
  const power = document.getElementById("power");
  if (config) {
    const off = config.because === "paused";
    power.hidden = false;
    power.disabled = false;
    power.dataset.on = off ? "false" : "true";
    power.textContent = off ? "Turn on" : "Turn off";
    power.className = off ? "power" : "power off";
    if (off) lines.push("Off.");
    else if (config.because === "outside hours") lines.push("On, but outside its hours. The window opens again then.");
    else lines.push(snap.windowOpen ? "On. Looking in its own window; it only reads, never comments." : "On. Opening its window…");
    const c = config.counts ?? {};
    counts.textContent = `Signed in as ${config.who ?? "?"}`;
    const review = document.getElementById("review");
    if ((c.toAnswer ?? 0) > 0) {
      review.hidden = false;
      review.href = config.postsUrl || `${APP}/admin/outreach/posts`;
      review.textContent = `${c.toAnswer} post${c.toAnswer === 1 ? "" : "s"} waiting for an answer`;
    } else {
      review.hidden = true;
    }
    const ext = config.extension;
    if (ext && ext.updateAvailable) {
      update.hidden = false;
      update.querySelector("a").href = ext.downloadUrl;
      update.querySelector("span").textContent = `A newer version (${ext.expectedVersion}) is ready. This one keeps running until you swap it.`;
    } else {
      update.hidden = true;
    }
  } else {
    counts.textContent = "";
    update.hidden = true;
  }
  if (snap.status?.text) {
    const ago = Math.max(0, Math.round((Date.now() - snap.status.at) / 60000));
    lines.push(`${snap.status.text} (${ago === 0 ? "just now" : `${ago} min ago`})`);
  }
  status.textContent = lines.join(" ");
}

function ask(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

ask({ type: "status" }).then(render);

document.getElementById("power").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const turningOn = button.dataset.on !== "true";
  button.disabled = true;
  button.textContent = turningOn ? "Turning on…" : "Turning off…";
  render(await ask({ type: "power", on: turningOn }));
});
document.getElementById("look").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Looking…";
  render(await ask({ type: "look-now" }));
});
document.getElementById("hand").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await ask({ type: "answer-by-hand", tabId: tab.id });
  window.close();
});
