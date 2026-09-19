/**
 * The phone's own voice.
 *
 * Web Speech is on every phone the crew carry and needs nothing installed.
 * Each call cancels what was still being said: an instruction half-read
 * over a newer one is worse than either on its own.
 */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function speak(text: string): void {
  if (!canSpeak() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // A phone that cannot speak still shows the words.
  }
}

export function hushSpeech(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing to stop.
  }
}

const KEY = "directions.voice";

/** Whether the voice is on, remembered per phone. On until somebody turns it off. */
export function voiceWanted(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function rememberVoice(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode. It will just ask again next time.
  }
}
