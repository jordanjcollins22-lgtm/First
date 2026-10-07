/**
 * Getting a generated PDF into somebody's hands on a phone.
 *
 * The app declares itself standalone, so anybody who has added it to their
 * home screen is not running inside Safari — they are running inside a window
 * with no browser chrome at all. Opening a PDF there shows the document and
 * nothing else: no toolbar, no share button, no print. The file is on the
 * screen and there is no way to get it onto paper, which is the whole point
 * of a sheet that exists to be printed.
 *
 * The way out is the share sheet the operating system already has. Handing it
 * the file gives a native menu with Print on it, and that menu works the same
 * whether the app is in a browser tab or on a home screen.
 *
 * Three routes, and the right one depends on what the device can do:
 *
 * - **Share** the file, where the browser will take one. One tap to a menu
 *   with Print, AirPrint, Save to Files and Mail on it.
 * - **Open** it in a new tab, on a desktop browser, where the built-in viewer
 *   has its own print button and is what people expect.
 * - **Download** it, when neither of those is available. It lands in Files or
 *   the downloads folder, and printing is a couple of taps from there.
 *
 * The decision is made here so it can be tested without a phone.
 */

export type Delivery = "share" | "open" | "download";

/**
 * The parts of `navigator` this needs, so a test can supply them.
 *
 * The arguments are deliberately loose. The real `Navigator` types `share` as
 * taking `ShareData | undefined`, and a stricter signature here would make the
 * genuine article fail to match its own stand-in.
 */
export interface ShareCapableNavigator {
  share?: (data?: never) => Promise<void>;
  canShare?: (data?: never) => boolean;
}

/**
 * Whether this browser will take a file on its share sheet.
 *
 * Both halves are checked. Some browsers expose `share` for links and text
 * while refusing files, and calling it with a file there throws rather than
 * falling back, which would leave somebody staring at a button that does
 * nothing.
 */
export function canShareFile(nav: ShareCapableNavigator | undefined, file: unknown): boolean {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return (nav.canShare as (data: unknown) => boolean)({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * How to hand this file over.
 *
 * A standalone window has no print button of its own, so opening the PDF
 * there is the one thing that definitely does not work — it is only offered
 * when there is browser chrome around it to print from.
 */
export function deliveryFor(input: {
  canShare: boolean;
  /** Running from a home screen, with no browser toolbar. */
  standalone: boolean;
  /** A phone or tablet, where "open in a tab" is a poor answer anyway. */
  touch: boolean;
}): Delivery {
  if (input.canShare) return "share";
  if (input.standalone || input.touch) return "download";
  return "open";
}

/**
 * Whether this window has no browser chrome around it.
 *
 * Two ways of asking because the two platforms answer differently: Android
 * and desktop set the display-mode media query, and iOS sets a property on
 * navigator that predates it and never got replaced.
 */
export function isStandalone(win: unknown): boolean {
  try {
    const w = win as {
      matchMedia?: (query: string) => { matches: boolean };
      // Non-standard, and iOS only, which is why it is not on the built-in
      // Navigator type and has to be reached for like this.
      navigator?: { standalone?: unknown };
    };
    if (w?.navigator?.standalone === true) return true;
    return w?.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

/**
 * The file's name, from the header the server already set.
 *
 * Worth taking rather than inventing: the routes name these files after the
 * business and the kit, and a share sheet shows that name. "document.pdf" in
 * somebody's Files is a sheet they will not find again.
 */
export function fileNameFrom(disposition: string | null | undefined, fallback: string): string {
  const header = disposition ?? "";
  // RFC 5987 first: a name with a space or a non-ASCII character is sent this
  // way, and the plain filename beside it is a mangled copy of the same thing.
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
      if (decoded) return decoded;
    } catch {
      // Fall through to the plain one.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  const name = plain?.[1]?.trim();
  return name || fallback;
}
