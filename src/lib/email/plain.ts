/**
 * Plain text as HTML, for mail written as text.
 *
 * The evaluation emails are written as paragraphs of text. Mail clients
 * want an HTML part too, or the message renders as a wall in some and is
 * scored down in others. This keeps the text exactly as written: escaped,
 * paragraphs kept, and links made clickable. Nothing else.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const body = paragraphs
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, "<br>");
      const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}">${url}</a>`);
      return `<p style="margin:0 0 1em">${linked}</p>`;
    })
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${body}</div>`;
}
