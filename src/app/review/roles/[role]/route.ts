import { CLIENT_SCRIPT, PHONE_CSS, PHONE_SCRIPT } from "@/lib/review/role-phones";
import { reviewPagesEnabled } from "@/lib/review-pages";

/**
 * Each role's phone page with sample data, drawn exactly as the Project Hub's
 * role mock-ups draw it (same styles and screens, copied in role-phones.ts),
 * full screen so it can be opened on a phone. Preview deployments only.
 */
export const dynamic = "force-dynamic";

const ROLES: Record<string, { key: string; label: string }> = {
  affiliate: { key: "aff", label: "Affiliate" },
  technician: { key: "tech", label: "Project technician" },
  "account-manager": { key: "am", label: "Account manager" },
  partner: { key: "partner", label: "Location partner" },
  owner: { key: "owner", label: "Owner" },
};

export async function GET(_req: Request, { params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const r = ROLES[role];
  if (!reviewPagesEnabled() || !r) return new Response("Not found", { status: 404 });

  const nav = Object.entries(ROLES)
    .map(([slug, v]) => `<a href="/review/roles/${slug}"${slug === role ? ' aria-current="page"' : ""}>${v.label}</a>`)
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${r.label} · preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap">
<style>${PHONE_CSS}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--body);font-size:15px;line-height:1.55}
.wrap{display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px}
.vx-phone{position:static}
@media (max-width:480px){.wrap{padding:0}.vx-phone{width:100%;border:0;border-radius:0;box-shadow:none}}
.nav{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:0 16px 20px;font:500 12px var(--mono)}
.nav a{color:var(--teal);border:1px solid var(--line);border-radius:999px;padding:5px 10px;text-decoration:none}
.nav a[aria-current]{background:var(--teal);color:var(--surface);border-color:var(--teal)}
.note{font-size:12px;color:var(--muted);text-align:center;padding:0 16px}
</style></head><body>
<div class="wrap"><div class="vx-phone" aria-label="${r.label} phone"><div class="vx-bar"><span id="vx-bar-url"></span></div><div class="vx-screen" id="vx-screen"></div></div></div>
<p class="note">Layout preview with sample data, not real people.</p>
<nav class="nav">${nav}</nav>
<script>window.ROLE=${JSON.stringify(r.key)};</script>
${PHONE_SCRIPT}
${CLIENT_SCRIPT}
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
}
