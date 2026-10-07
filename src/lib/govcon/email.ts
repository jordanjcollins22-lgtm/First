/**
 * Outbound email via Resend's HTTP API (no SDK needed). Optional: without
 * RESEND_API_KEY the pipeline still runs and RFQs wait in the dashboard's
 * outbox / call list.
 */
export const isEmailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.GOVCON_FROM_EMAIL);

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
}

export async function sendEmail(msg: OutboundEmail): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.GOVCON_FROM_EMAIL;
  if (!key || !from) throw new Error("Email not configured (RESEND_API_KEY / GOVCON_FROM_EMAIL)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? textToHtml(msg.text),
      reply_to: msg.replyTo ?? process.env.GOVCON_REPLY_TO ?? undefined,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { id: string };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text → minimal HTML, turning bare URLs into links. */
export function textToHtml(text: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${body}</div>`;
}
