"use client";

import { useState, useTransition } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

/** Button that runs a server action and shows pending/error state. */
export function ActionButton({
  action,
  children,
  confirmText,
  pendingText = "Working…",
  ...props
}: Omit<ButtonProps, "onClick"> & { action: () => Promise<unknown>; confirmText?: string; pendingText?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        {...props}
        disabled={pending || props.disabled}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          setError(null);
          start(async () => {
            try {
              await action();
            } catch (e) {
              setError((e as Error).message);
            }
          });
        }}
      >
        {pending ? pendingText : children}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
