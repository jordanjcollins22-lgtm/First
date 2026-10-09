"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageTabs } from "@/components/ui/page-tabs";
import { cn } from "@/lib/utils";
import {
  forgetPage,
  openThread,
  refreshMetaPages,
  saveMetaApp,
  sendMetaReply,
  setPageRoles,
} from "@/lib/actions/meta-actions";
import type { MetaMessage, MetaPageRow, MetaSetup, MetaThread } from "@/lib/data/meta";

const ROLE_INFO: { key: string; label: string; help: string }[] = [
  { key: "posting", label: "Posting", help: "The week's approved posts go to this page. One page at a time." },
  { key: "inbox", label: "Inbox", help: "Its Messenger and Instagram messages come in here." },
  { key: "collector", label: "Post collector", help: "Affiliates send it posts to comment on." },
];

export function MetaAdmin(props: {
  setup: MetaSetup;
  pages: MetaPageRow[];
  threads: MetaThread[];
  canManage: boolean;
  redirectUri: string;
  webhookUrl: string;
  privacyUrl: string;
  bookingUrl: string;
  notice: { tone: "good" | "bad"; text: string } | null;
}) {
  const connected = props.pages.length > 0;
  const unread = props.threads.reduce((n, t) => n + t.unread, 0);
  return (
    <div className="space-y-4">
      {props.notice && (
        <p
          className={cn(
            "rounded-lg border p-3 text-sm",
            props.notice.tone === "good" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"
          )}
        >
          {props.notice.text}
        </p>
      )}
      <PageTabs
        initialKey={connected ? "inbox" : "setup"}
        tabs={[
          {
            key: "inbox",
            label: unread ? `Inbox (${unread})` : "Inbox",
            blurb: "Every connected page's Messenger and Instagram messages.",
            content: <Inbox threads={props.threads} connected={connected} bookingUrl={props.bookingUrl} />,
          },
          {
            key: "pages",
            label: `Pages (${props.pages.length})`,
            blurb: "What each page is for. New pages show up after Refresh pages.",
            content: <Pages pages={props.pages} canManage={props.canManage} setup={props.setup} />,
          },
          {
            key: "setup",
            label: "Setup",
            blurb: "Your Meta app, pasted in once.",
            content: <Setup {...props} />,
          },
        ]}
      />
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Setup(props: {
  setup: MetaSetup;
  canManage: boolean;
  redirectUri: string;
  webhookUrl: string;
  privacyUrl: string;
  pages: MetaPageRow[];
}) {
  const router = useRouter();
  const [appId, setAppId] = useState(props.setup.appId ?? "");
  const [secret, setSecret] = useState("");
  const [configId, setConfigId] = useState(props.setup.loginConfigId ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ready = Boolean(props.setup.appId && props.setup.hasSecret);

  function save() {
    start(async () => {
      const result = await saveMetaApp({ appId, appSecret: secret, loginConfigId: configId });
      setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
      if (result.ok) {
        setSecret("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">1. Make the Meta app (once)</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            On <b>developers.facebook.com</b>: My Apps → Create App → Other → Business, in your business portfolio.
          </li>
          <li>Add the products <b>Messenger</b>, <b>Instagram</b> (API setup with Facebook login) and <b>Facebook Login for Business</b>.</li>
          <li>
            Facebook Login for Business → Settings → <b>Valid OAuth Redirect URIs</b>: <Copyable text={props.redirectUri} />
          </li>
          <li>
            App settings → Basic → <b>Privacy policy URL</b>: <Copyable text={props.privacyUrl} />
          </li>
          <li>Copy the <b>App ID</b> and the <b>App secret</b> from App settings → Basic into the boxes below.</li>
        </ol>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">2. Paste it in</h2>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">App ID</span>
          <Input value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" disabled={!props.canManage} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">App secret</span>
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={props.setup.hasSecret ? "Saved. Leave blank to keep it." : "32 letters and numbers"}
            autoComplete="off"
            disabled={!props.canManage}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Login configuration ID (optional)</span>
          <Input value={configId} onChange={(e) => setConfigId(e.target.value)} inputMode="numeric" disabled={!props.canManage} />
          <span className="block text-xs text-muted-foreground">
            Only if Facebook Login for Business asks for one: Configurations → Create, with the Messenger and Instagram
            permissions. Leave blank and the usual permission list is asked for.
          </span>
        </label>
        {props.canManage ? (
          <Button onClick={save} disabled={pending || !appId.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
        )}
        {message && <p className={cn("text-sm", message.ok ? "text-emerald-700" : "text-red-700")}>{message.text}</p>}
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">3. Connect</h2>
        <p className="text-sm text-muted-foreground">
          Facebook asks which pages to allow. Choose every page you want here (and its Instagram) and allow every
          permission. The app keeps a key for each page, finds its Instagram, and switches messages on by itself.
        </p>
        {props.canManage && (
          <Button asChild={ready} disabled={!ready}>
            {ready ? <a href="/api/meta/connect">{props.pages.length ? "Connect again" : "Connect Facebook"}</a> : <span>Connect Facebook</span>}
          </Button>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Connected</dt>
          <dd>{when(props.setup.connectedAt)}</dd>
          <dt className="text-muted-foreground">Messages switched on</dt>
          <dd>{when(props.setup.webhooksAt)}</dd>
          {props.setup.lastError && (
            <>
              <dt className="text-muted-foreground">Last problem</dt>
              <dd className="text-red-700">{props.setup.lastError}</dd>
            </>
          )}
        </dl>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">If Meta asks for the webhook by hand</summary>
          <p className="mt-1">
            Callback URL <Copyable text={props.webhookUrl} />, verify token <Copyable text={props.setup.verifyToken} />.
          </p>
        </details>
      </section>

      <section className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">Customers&apos; messages</h2>
        <p className="mt-1">
          Until Meta approves the app, only people with a role on it (you, and anyone added under App roles) get
          through. For everyone else: verify the business in Business Settings, then App Review → request advanced
          access to pages_messaging, pages_manage_metadata, pages_show_list, pages_read_engagement, pages_manage_posts,
          instagram_basic and instagram_manage_messages, and switch the app to Live.
        </p>
      </section>
    </div>
  );
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-muted/70"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy"
    >
      {copied ? "Copied" : text}
    </button>
  );
}

function Pages({ pages, canManage, setup }: { pages: MetaPageRow[]; canManage: boolean; setup: MetaSetup }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function refresh() {
    start(async () => {
      const result = await refreshMetaPages();
      setMessage(
        result.ok
          ? { ok: true, text: `Found ${result.value?.pages ?? 0} page(s).${result.value?.failed ? ` ${result.value.failed} couldn't switch on messages.` : ""}` }
          : { ok: false, text: result.error }
      );
      router.refresh();
    });
  }

  function toggle(page: MetaPageRow, role: string) {
    const roles = page.roles.includes(role as MetaPageRow["roles"][number])
      ? page.roles.filter((r) => r !== role)
      : [...page.roles, role];
    start(async () => {
      const result = await setPageRoles({ rowId: page.id, roles });
      if (!result.ok) setMessage({ ok: false, text: result.error });
      router.refresh();
    });
  }

  function forget(page: MetaPageRow) {
    if (!window.confirm(`Stop using ${page.name} here? Its messages stay.`)) return;
    start(async () => {
      const result = await forgetPage(page.id);
      if (!result.ok) setMessage({ ok: false, text: result.error });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canManage && setup.connectedAt && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={refresh} disabled={pending}>
            {pending ? "Working…" : "Refresh pages"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Made a new page? Refresh. If it doesn&apos;t show, use Connect again on Setup and tick it on Facebook&apos;s screen.
          </span>
        </div>
      )}
      {message && <p className={cn("text-sm", message.ok ? "text-emerald-700" : "text-red-700")}>{message.text}</p>}
      {pages.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No pages yet. Finish Setup first.</p>
      ) : (
        pages.map((page) => (
          <div key={page.id} className="space-y-2 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{page.name}</p>
                <p className="text-xs text-muted-foreground">
                  {page.instagramUsername ? `Instagram @${page.instagramUsername}` : page.instagramId ? "Instagram linked" : "No Instagram linked"}
                  {" · "}
                  {page.subscribedAt ? "messages on" : "messages off"}
                </p>
                {page.lastError && <p className="mt-1 text-xs text-red-700">{page.lastError}</p>}
              </div>
              {canManage && (
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => forget(page)}>
                  Remove
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {ROLE_INFO.map((role) => {
                const on = page.roles.includes(role.key as MetaPageRow["roles"][number]);
                return (
                  <button
                    key={role.key}
                    type="button"
                    title={role.help}
                    disabled={!canManage || pending}
                    onClick={() => toggle(page, role.key)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                    )}
                  >
                    {on ? "✓ " : ""}
                    {role.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Inbox({ threads, connected, bookingUrl }: { threads: MetaThread[]; connected: boolean; bookingUrl: string }) {
  const [open, setOpen] = useState<MetaThread | null>(null);
  if (!connected) {
    return <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Connect Facebook on Setup and messages will arrive here.</p>;
  }
  if (threads.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        No messages yet. Send your page a message from your personal Facebook to test it.
      </p>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ul className={cn("divide-y divide-border rounded-lg border border-border", open && "hidden md:block")}>
        {threads.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => setOpen(t)}
              className={cn("w-full px-3 py-2.5 text-left hover:bg-muted/50", open?.key === t.key && "bg-muted")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm", t.unread && "font-semibold")}>{t.contactName ?? "Someone"}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{when(t.lastAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">{t.lastBody ?? "(attachment)"}</span>
                {t.unread > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{t.unread}</span>}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {t.platform === "instagram" ? "Instagram" : "Messenger"} · {t.pageName}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <Conversation key={open.key} thread={open} bookingUrl={bookingUrl} onBack={() => setOpen(null)} />
      ) : (
        <p className="hidden rounded-lg border border-border p-4 text-sm text-muted-foreground md:block">Choose a conversation.</p>
      )}
    </div>
  );
}

function Conversation({ thread, bookingUrl, onBack }: { thread: MetaThread; bookingUrl: string; onBack: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<MetaMessage[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = { pageRowId: thread.pageRowId, platform: thread.platform, contactId: thread.contactId };
  const [now] = useState(() => Date.now());
  const windowOpen = Boolean(thread.lastIncomingAt && now - new Date(thread.lastIncomingAt).getTime() < 24 * 3_600_000);

  useEffect(() => {
    let live = true;
    void openThread({ pageRowId: thread.pageRowId, platform: thread.platform, contactId: thread.contactId }).then((result) => {
      if (!live) return;
      setMessages(result.ok ? (result.value ?? []) : []);
      if (!result.ok) setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [thread.pageRowId, thread.platform, thread.contactId]);

  function send() {
    setError(null);
    start(async () => {
      const result = await sendMetaReply({ ...ref, text });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((m) => [...(m ?? []), { id: `sent-${Date.now()}`, direction: "out", body: text.trim(), attachments: [], createdAt: new Date().toISOString() }]);
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-[24rem] flex-col rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button type="button" className="text-sm text-muted-foreground md:hidden" onClick={onBack}>
          ←
        </button>
        <div>
          <p className="text-sm font-semibold">{thread.contactName ?? "Someone"}</p>
          <p className="text-[11px] text-muted-foreground">
            {thread.platform === "instagram" ? "Instagram" : "Messenger"} · {thread.pageName}
          </p>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {m.body}
                {m.attachments.map((a, i) =>
                  a.url ? (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs underline">
                      {a.title ?? (a.type === "image" ? "Photo" : a.type === "share" ? "Shared post" : "Attachment")}
                    </a>
                  ) : null
                )}
                <span className="mt-0.5 block text-[10px] opacity-70">{when(m.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="space-y-2 border-t border-border p-3">
        {!windowOpen && (
          <p className="text-xs text-amber-800">
            More than 24 hours since they last wrote: Facebook won&apos;t take a reply from the app. Answer from Facebook or Instagram.
          </p>
        )}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write a reply…" disabled={!windowOpen} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={send} disabled={pending || !text.trim() || !windowOpen}>
            {pending ? "Sending…" : "Send"}
          </Button>
          <Button
            variant="outline"
            disabled={!windowOpen}
            onClick={() => setText((t) => `${t.trim()}${t.trim() ? "\n\n" : ""}Pick a time for a free evaluation here: ${bookingUrl}`)}
          >
            Add booking link
          </Button>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
