"use client";

import { useState, useTransition } from "react";
import { Play } from "lucide-react";

import { Input } from "@/components/ui/input";
import { updateToolHowToUrl } from "@/lib/actions/tool-actions";

/** Paste-a-YouTube-link input for one tool, with a watch link once it's set. */
export function ToolVideoLinkInput({ toolId, initialUrl }: { toolId: string; initialUrl: string | null }) {
  const [value, setValue] = useState(initialUrl ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateToolHowToUrl(toolId, value.trim() || null));
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="url"
        placeholder="YouTube how-to link"
        value={value}
        disabled={isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        className="h-8 w-52 text-xs"
      />
      {value.trim() && (
        <a
          href={value.trim()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-0.5 text-xs text-primary underline-offset-2 hover:underline"
        >
          <Play className="h-3 w-3" /> Watch
        </a>
      )}
    </div>
  );
}
