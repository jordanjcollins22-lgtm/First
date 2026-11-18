/** A plain page that says how connecting went, for the tab Facebook sends the owner back to. */
export function resultPage(message: string, ok: boolean): Response {
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facebook page</title>
<body style="font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f5;color:#1d2a1f">
<div style="max-width:420px;padding:24px;border-radius:14px;background:#fff;box-shadow:0 2px 12px #0001"><h1 style="font-size:20px;margin:0 0 8px">${ok ? "Connected" : "Not connected yet"}</h1><p style="margin:0">${safe}</p></div></body>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
