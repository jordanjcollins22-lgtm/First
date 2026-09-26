/**
 * The parts of the browser agent that change, kept where a deploy reaches them.
 *
 * A folder loaded into Chrome never updates itself, and nearly every fix
 * the agent will ever need is Facebook moving a button: the comment box
 * under a new label, "See more" renamed, the mention picker drawn another
 * way. So the extension carries no selector of its own. It asks the app
 * for this recipe each minute and reads the page with it. A layout change
 * is fixed here, deployed, and every copy of the extension has it within
 * a minute, with nothing to download.
 *
 * The rare change that needs new extension code bumps the version below.
 * The popup compares it with the copy installed and shows a download link.
 *
 * Patterns are strings, not RegExp objects, because they travel as JSON.
 * The extension builds them with the "i" flag.
 */

export const EXTENSION_VERSION = "2.7.0";
/** Packed from the extension folder on every build; see scripts/zip-extension.mjs. */
export const EXTENSION_DOWNLOAD_URL = "https://app.jslandscapingmd.com/downloads/js-post-finder.zip";

export interface AgentRecipe {
  version: number;
  scan: {
    /** The box that is one post. Comments are nested articles and are skipped. */
    article: string;
    seeMoreText: string;
    postLink: string;
    groupLink: string;
    notGroupLink: string;
    profileLink: string;
    anonymous: string;
    messageBody: string;
    authorFallback: string;
    scrollTimes: number;
    /** How far each scroll goes, in screens. Under one, so nothing is skipped between reads. */
    scrollScreens: number;
    scrollWaitMs: number;
    /** How long to wait after hovering a post's links for Facebook to fill in the real ones. */
    revealWaitMs: number;
    /**
     * For a post that still has no link, open its Share menu and press
     * "Copy link", catching the link as Facebook copies it. Only posts that
     * mention the work, and only so many a look.
     */
    shareForLink: boolean;
    shareButton: string;
    copyLinkText: string;
    shareMax: number;
    shareMenuWaitMs: number;
    copyWaitMs: number;
    settleMs: number;
    searchSettleMs: number;
    maxPosts: number;
    maxTextChars: number;
  };
  post: {
    commentBox: string;
    commentBoxLabel: string;
    openCommentLabel: string;
    joinButton: string;
    submitButton: string;
    mentionOption: string;
    dialog: string;
    blocked: string;
    settleMs: number;
    afterOpenMs: number;
    afterFocusMs: number;
    mentionWaitMs: number;
    afterTypeMs: number;
    beforeSendMinMs: number;
    beforeSendJitterMs: number;
    afterSendMs: number;
    verifyTries: number;
  };
  /**
   * The finder's own window, kept open while it is on. Each minute it
   * scrolls further down the page it is on; after a while it moves to the
   * next place to look, and back to the top of the feed for what is new.
   */
  watch: {
    /** Scrolls in each minute's look. */
    scrollsPerLook: number;
    /** Minutes on the groups feed before moving on. */
    feedMinutes: number;
    /** Minutes on a search or a listed group before moving on. */
    otherMinutes: number;
    /** After this many scrolls down one page, start it again from the top. */
    reloadAfterScrolls: number;
  };
  pacing: {
    minDelaySeconds: number;
    maxDelaySeconds: number;
    stalePostHours: number;
    tabLoadTimeoutMs: number;
  };
}

export const DEFAULT_RECIPE: AgentRecipe = {
  version: 1,
  scan: {
    // Facebook marks a feed post with a position in the feed, and some pages
    // still with an article role. Either counts; the outermost one wins.
    article: '[aria-posinset], [role="article"], [data-pagelet^="FeedUnit"]',
    seeMoreText: "^see more$",
    postLink: "\\/groups\\/[^/]+\\/(posts|permalink)\\/|story_fbid=|multi_permalinks=|\\/posts\\/pfbid",
    groupLink: "\\/groups\\/[^/?#]+\\/?(\\?|#|$)",
    notGroupLink: "\\/groups\\/(feed|discover|joins)\\b",
    profileLink: "\\/groups\\/[^/]+\\/user\\/\\d+|\\/profile\\.php\\?id=\\d+|^https?:\\/\\/(www\\.)?facebook\\.com\\/[A-Za-z0-9.]+\\/?(\\?|$)",
    anonymous: "anonymous (participant|member)",
    messageBody: '[data-ad-preview="message"], [data-ad-comet-preview="message"]',
    authorFallback: "h2 strong, h3 strong, h4 strong, strong a, strong",
    scrollTimes: 10,
    scrollScreens: 0.9,
    scrollWaitMs: 1400,
    revealWaitMs: 500,
    shareForLink: true,
    shareButton: "^share$|^send this to friends or post it on your profile\\.?$",
    copyLinkText: "^copy link$",
    shareMax: 15,
    shareMenuWaitMs: 1200,
    copyWaitMs: 700,
    settleMs: 4000,
    searchSettleMs: 6000,
    maxPosts: 40,
    maxTextChars: 3000,
  },
  post: {
    commentBox: '[contenteditable="true"][role="textbox"]',
    commentBoxLabel: "comment",
    openCommentLabel: "^(leave a )?comment$|^write a comment",
    joinButton: "^(join group|join|request to join)$",
    submitButton: '[aria-label="Comment"][role="button"], [aria-label="Post"][role="button"], [aria-label="Submit"][role="button"]',
    mentionOption: '[role="listbox"] [role="option"], [role="option"]',
    dialog: '[role="dialog"]',
    blocked: "temporarily blocked|action blocked|can'?t use this feature|you.re blocked|going too fast|restricted from",
    settleMs: 5000,
    afterOpenMs: 1500,
    afterFocusMs: 500,
    mentionWaitMs: 1800,
    afterTypeMs: 800,
    beforeSendMinMs: 1200,
    beforeSendJitterMs: 1500,
    afterSendMs: 2500,
    verifyTries: 8,
  },
  watch: {
    scrollsPerLook: 14,
    feedMinutes: 10,
    otherMinutes: 3,
    reloadAfterScrolls: 140,
  },
  pacing: {
    minDelaySeconds: 90,
    maxDelaySeconds: 300,
    stalePostHours: 12,
    tabLoadTimeoutMs: 30000,
  },
};

/** Whether an installed copy is older than the one the app expects. */
export function versionIsBehind(installed: string | null | undefined, expected: string): boolean {
  const parse = (v: string) => v.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse((installed ?? "0").trim());
  const b = parse(expected.trim());
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
