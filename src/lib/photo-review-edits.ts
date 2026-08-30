/**
 * A photo review as the screen shows it, before the server has agreed.
 *
 * The marks come from the server, so every change to them used to arrive a
 * round trip late: a manager standing in a driveway tapped "done", watched
 * the punch list sit there, and tapped it again. The screen applies the
 * change to its own copy first and the server catches up behind it.
 *
 * The edits are described rather than applied in the component so the rules
 * that read a mark — what is still outstanding, whether the job can be signed
 * off — get the same shape of list either way. A screen that showed a resolved
 * mark as gone but still refused to approve would be the worst of both.
 */

import type { PhotoMark } from "@/lib/photo-review";

export type MarkEdit =
  | { kind: "added"; mark: PhotoMark }
  | { kind: "resolved"; id: string; at: string }
  | { kind: "removed"; id: string };

/** The list as it looks with one not-yet-confirmed change applied. */
export function applyMarkEdit(marks: PhotoMark[], edit: MarkEdit): PhotoMark[] {
  switch (edit.kind) {
    case "added":
      return [...marks, edit.mark];
    case "resolved":
      // Resolved, not dropped: an approval only covers the marks that existed
      // when it was given, and that check reads the ones already cleared too.
      return marks.map((mark) =>
        mark.id === edit.id ? { ...mark, resolvedAt: edit.at } : mark
      );
    case "removed":
      return marks.filter((mark) => mark.id !== edit.id);
  }
}

/**
 * The mark the screen draws while the real one is being written.
 *
 * Trimmed and clamped exactly as the server does it, because the pin the
 * manager sees land is the one that has to still be there a second later. A
 * pin that shifts when the page catches up reads as a bug in the pin.
 */
export function provisionalMark(input: {
  id: string;
  photoId: string;
  x: number;
  y: number;
  note: string;
  at: string;
}): PhotoMark {
  return {
    id: input.id,
    photoId: input.photoId,
    x: Math.min(1, Math.max(0, input.x)),
    y: Math.min(1, Math.max(0, input.y)),
    note: input.note.trim(),
    // Who wrote it and when it was cleared are the server's answers to give.
    authorName: null,
    createdAt: input.at,
    resolvedAt: null,
    resolvedByName: null,
  };
}
