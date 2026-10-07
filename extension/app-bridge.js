// The bridge between the app and this extension.
//
// Runs on the app's own pages only. When the Start or Stop button is pressed
// in the app, the page says so here, and the finder starts or stops at once
// rather than at its next once-a-minute check. It also tells the page the
// extension is here, so the app can say whether this Chrome will do the
// finding. Nothing else passes either way.
const FROM_APP = "js-finder-app";
const FROM_EXTENSION = "js-finder-extension";
const version = chrome.runtime.getManifest().version;

function say(message) {
  window.postMessage({ source: FROM_EXTENSION, version, ...message }, location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.source !== FROM_APP) return;
  if (message.type === "hello") say({ type: "here" });
  if (message.type === "power") {
    // The app has already turned it on or off; this is only "now, not in a minute".
    chrome.runtime.sendMessage({ type: "app-power" }, (snap) => {
      say({ type: "power-done", windowOpen: Boolean(snap && snap.windowOpen) });
    });
  }
});

say({ type: "here" });
