// The popup: what the finder is doing, the posts waiting for the team, and
// a word when the app has a newer copy. It has no switch of its own: the
// finder is started and stopped by the one button in the app, on Where
// Posts Come From, and this extension hears it at once.
const APP = "https://app.jslandscapingmd.com";
document.getElementById("switch").href = `${APP}/admin/outreach/agent`;

function render(snap) {
  const status = document.getElementById("status");
  const waiting = document.getElementById("waiting");
  const update = document.getElementById("update");
  document.getElementById("version").textContent = snap?.version ? `v${snap.version}` : "";

  const config = snap?.config ?? null;

  const lines = [];
  if (!config) lines.push("Sign in to the app in this Chrome.");
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
