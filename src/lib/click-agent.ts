/**
 * What asked for a tracked link: a person, or a machine looking on their
 * behalf.
 *
 * A link posted in a Facebook comment is fetched a dozen times within two
 * seconds by Facebook's own crawlers, before any person has seen it, and
 * every messaging app, search engine and security scanner does the same.
 * Counting those as opens made every comment look read by ten people the
 * minute it went up. So a request is sorted first, and only a person's
 * browser counts. The label kept is a family, never the whole string, which
 * is as much as an audit needs and as little as a stranger's browser should
 * leave behind.
 */

export type AgentFamily = "browser" | "crawler" | "script" | "unknown";

const CRAWLER =
  /facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|slackbot|slack-imgproxy|whatsapp|telegrambot|discordbot|skypeuripreview|pinterest|redditbot|applebot|googlebot|google-inspectiontool|bingbot|bingpreview|yandex|duckduckbot|baiduspider|semrush|ahrefs|mj12bot|petalbot|bytespider|gptbot|claudebot|ccbot|snapchat|nextdoor|embedly|iframely|vkshare|quora link preview|outbrain|w3c_validator|headlesschrome|phantomjs|lighthouse|pagespeed|gtmetrix|uptimerobot|pingdom|statuscake|site24x7|newrelic|datadog|checkly|bot\b|crawler|spider|preview|scanner|monitor|validator/i;

const SCRIPT = /^(curl|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpclient|axios|node-fetch|undici|postman|insomnia|scrapy)/i;

export function classifyAgent(userAgent: string | null | undefined): AgentFamily {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "unknown";
  if (CRAWLER.test(ua)) return "crawler";
  if (SCRIPT.test(ua)) return "script";
  if (/mozilla|applewebkit|chrome|safari|firefox|edg\/|opera|fban|fbav|instagram|samsungbrowser/i.test(ua)) return "browser";
  return "unknown";
}

/** Only a person's browser is an open. A HEAD request is a check, not a visit. */
export function countsAsOpen(method: string, userAgent: string | null | undefined): boolean {
  if (method.toUpperCase() !== "GET") return false;
  return classifyAgent(userAgent) === "browser";
}
