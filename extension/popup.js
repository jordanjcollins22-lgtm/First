// The popup: one switch to start and stop the finder, what it is doing, the
// posts waiting for the team, and a word when the app has a newer copy.
const APP = "https://app.jslandscapingmd.com";

function render(snap) {
  const power = document.getElementById("power");
  const status = document.getElementById("status");
  const waiting = document.getElementById("waiting");
  const update = document.getElementById("update");
  document.getElementById("version").textContent = snap?.version ? `v${snap.version}` : "";

  const config = snap?.config ?? null;
  const on = Boolean(config) && config.because !== "paused";
  power.disabled = false;
  power.dataset.on = on ? "true" : "false";
  power.textContent = on ? "Turn off" : "Turn on";
  power.className = on ? "power off" : "power";

  const lines = [];
  if (!config) lines.push("Sign in to the app in this Chrome, then press Turn on.");
  else if (config.because === "paused") lines.push("Off. Nothing is being read.");
  else if (config.because === "outside hours") lines.push("On, but outside its hours. The window opens again when they start.");
  else lines.push(snap.windowOpen ? "On. Scrolling Facebook in its own window." : "On. Opening its window…");
  if (snap?.status?.text && config && config.because !== "paused") {
    const ago = Math.max(0, Math.round((Date.now() - snap.status.at) / 60000));
    lines.push(`${snap.status.text} (${ago === 0 ? "just now" : `${ago} min ago`})`);
  }
  if (snap?.error) lines.push(`Something went wrong: ${snap.error}`);
  status.textContent = lines.join(" ");

  const toAnswer = config?.counts?.toAnswer ?? 0;
  waiting.hidden = toAnswer === 0;
  waiting.href = config?.postsUrl || `${APP}/admin/outreach/posts`;
  waiting.textContent = `${toAnswer} post${toAnswer === 1 ? "" : "s"} waiting for an answer`;

  const ext = config?.extension;
  update.hidden = !(ext && ext.updateAvailable);
  if (ext && ext.updateAvailable) {
    update.querySelector("a").href = ext.downloadUrl;
    update.querySelector("span").textContent = `A newer version (${ext.expectedVersion}) is ready.`;
  }
  document.getElementById("who").textContent = config?.who ? `Signed in as ${config.who}` : "";
}

function ask(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// Asked fresh each time the popup opens, so the switch is right straight away.
ask({ type: "status", fresh: true }).then(render);

document.getElementById("power").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const turningOn = button.dataset.on !== "true";
  button.disabled = true;
  button.textContent = turningOn ? "Turning on…" : "Turning off…";
  render(await ask({ type: "power", on: turningOn }));
});
