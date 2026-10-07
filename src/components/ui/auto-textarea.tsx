"use client";

import * as React from "react";

import { Textarea } from "@/components/ui/textarea";
import { COMPOSER_MAX_HEIGHT, growHeight } from "@/lib/autogrow";

/**
 * A message box that shows the whole message.
 *
 * Measured rather than guessed from character counts: line wrapping depends
 * on the font, the width and the words, and the browser is the only thing
 * that knows all three. Height is written straight onto the node — this is a
 * measurement of the DOM, not state anything else needs to re-render on.
 */
export const AutoTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { maxHeight?: number; minHeight?: number }
>(({ maxHeight = COMPOSER_MAX_HEIGHT, minHeight = 0, className, onChange, value, ...props }, forwardedRef) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const resize = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (!node) return;
      // Collapse first: scrollHeight of an already-tall box reports the box,
      // not the text, so a message getting shorter would never shrink it.
      node.style.height = "auto";
      // min defaults to 0 because the resting size comes from the element's
      // own min-height class, which CSS enforces over an inline height anyway.
      const { height, scrollable } = growHeight({
        scrollHeight: node.scrollHeight,
        min: minHeight,
        max: maxHeight,
      });
      node.style.height = `${height}px`;
      node.style.overflowY = scrollable ? "auto" : "hidden";
    },
    [maxHeight, minHeight]
  );

  // Runs on a programmatic change too — clearing the box after a send has to
  // shrink it back, and that never goes through onChange.
  React.useLayoutEffect(() => {
    resize(innerRef.current);
  }, [resize, value]);

  return (
    <Textarea
      {...props}
      value={value}
      ref={(node) => {
        innerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
        resize(node);
      }}
      onChange={(event) => {
        resize(event.currentTarget);
        onChange?.(event);
      }}
      className={className}
      style={{ resize: "none", ...props.style }}
    />
  );
});
AutoTextarea.displayName = "AutoTextarea";
