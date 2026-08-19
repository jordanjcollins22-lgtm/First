"use client";

import { useState } from "react";
import { Check, Copy, Database, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MigrationStatus } from "@/lib/data/schema-check";

/**
 * Getting outstanding SQL out of the app and into Supabase, from a phone.
 *
 * Applying a migration by hand on mobile otherwise means finding the file on
 * GitHub, selecting several hundred lines, and switching apps without losing
 * the clipboard. This is one tap to copy and one to open the editor.
 */
export function MigrationRunner({
  migrations,
  projectRef,
}: {
  migrations: MigrationStatus[];
  /** Supabase project ref, so the button opens the right SQL editor. */
  projectRef: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const pending = migrations.filter((m) => !m.applied);
  const allSql = pending.map((m) => `-- ${m.file}\n\n${m.sql}`).join("\n\n");

  async function copy(text: string, label: string) {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      // Clipboard access can be refused — an insecure origin, or a browser
      // that wants a fresher user gesture. Say so instead of looking broken.
      setFailed(true);
    }
  }

  const editorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : "https://supabase.com/dashboard";

  return (
    <div className="flex flex-col gap-4">
      {pending.length === 0 ? (
        <div className="rounded-xl border border-emerald-600/40 bg-emerald-50/60 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
            <Check className="h-4 w-4" />
            Database is up to date
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every migration this build knows about has been run.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {pending.length} migration{pending.length === 1 ? "" : "s"} still to run
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Copy the SQL, open the editor, paste, and press Run. Safe to run more than once — nothing
            in it applies twice.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            <Button
              type="button"
              className="h-12 w-full text-base font-semibold"
              onClick={() => copy(allSql, "all")}
            >
              {copied === "all" ? (
                <Check className="mr-2 h-5 w-5" />
              ) : (
                <Copy className="mr-2 h-5 w-5" />
              )}
              {copied === "all" ? "Copied" : `Copy all ${pending.length} migrations`}
            </Button>

            <a
              href={editorUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-base font-medium"
            >
              <ExternalLink className="h-5 w-5" />
              Open Supabase SQL editor
            </a>
          </div>

          {failed && (
            <p className="mt-2 text-xs text-destructive">
              Your browser wouldn&apos;t let the page copy. Long-press the SQL below and copy it by hand.
            </p>
          )}
        </div>
      )}

      {/* One per migration, for the case where a single one failed and the
          rest went through — re-running everything would work, but watching a
          specific one succeed is what tells you it was the problem. */}
      <ul className="flex flex-col gap-2">
        {migrations.map((migration) => (
          <li
            key={migration.file}
            className={`rounded-lg border p-3 ${
              migration.applied ? "border-border bg-card/60" : "border-amber-400/60 bg-amber-50/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  migration.applied ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
                }`}
              >
                {migration.applied ? <Check className="h-3.5 w-3.5" /> : "!"}
              </span>
              <p className="min-w-0 flex-1 truncate font-mono text-xs">{migration.file}</p>
              {!migration.applied && (
                <button
                  type="button"
                  onClick={() => copy(migration.sql, migration.file)}
                  className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium"
                >
                  {copied === migration.file ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === migration.file ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            {migration.creates.length > 0 && (
              <p className="mt-1 pl-8 text-[11px] text-muted-foreground">
                {migration.creates.join(", ")}
              </p>
            )}
            {migration.creates.length === 0 && (
              <p className="mt-1 pl-8 text-[11px] text-muted-foreground">
                Changes existing tables — status follows the migration before it.
              </p>
            )}
          </li>
        ))}
      </ul>

      {pending.length > 0 && (
        <details className="rounded-xl border border-border bg-card/60 p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            <Database className="mr-1 inline h-3.5 w-3.5" />
            Show the SQL
          </summary>
          <textarea
            readOnly
            value={allSql}
            rows={12}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-lg border border-border bg-background p-2 font-mono text-[11px]"
          />
        </details>
      )}
    </div>
  );
}
