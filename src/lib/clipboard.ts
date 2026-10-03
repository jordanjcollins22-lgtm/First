"use client";

/**
 * Copies text there and then, inside the tap, so opening the post's tab
 * straight after is still allowed. False if the browser would not.
 */
export function copyNow(text: string): boolean {
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.opacity = "0";
  document.body.appendChild(box);
  const active = document.activeElement as HTMLElement | null;
  try {
    box.select();
    box.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
    active?.focus?.();
  }
}

/** The clipboard the modern way, for browsers where copyNow would not. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

