"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createDocUploadUrls, registerUploadedDocs } from "@/lib/actions/govcon-actions";
import { createClient } from "@/lib/supabase/client";

/** Drop the bid documents (PDF, Word, Excel) downloaded from a portal. */
export function DocUpload({ opportunityId }: { opportunityId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const upload = () =>
    start(async () => {
      setMessage(null);
      try {
        const targets = await createDocUploadUrls(opportunityId, files.map((f) => f.name));
        const storage = createClient().storage.from("govcon-docs");
        const done: Array<{ name: string; path: string; size: number }> = [];
        for (const [i, t] of targets.entries()) {
          const { error } = await storage.uploadToSignedUrl(t.path, t.token, files[i]);
          if (error) throw new Error(`${files[i].name}: ${error.message}`);
          done.push({ name: files[i].name, path: t.path, size: files[i].size });
        }
        await registerUploadedDocs(opportunityId, done);
        setFiles([]);
        setMessage(`Uploaded ${done.length} file(s). They'll be read on the next pipeline run.`);
      } catch (e) {
        setMessage((e as Error).message);
      }
    });

  return (
    <div className="space-y-2">
      <input
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.txt"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="block w-full text-sm"
      />
      <Button type="button" size="sm" disabled={!files.length || pending} onClick={upload}>
        {pending ? "Uploading…" : `Upload ${files.length || ""} document${files.length === 1 ? "" : "s"}`}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
