import type { JSX } from "react";

/**
 * The working screens the new layout's choices can show, by key. Each is an
 * async server component that loads its own data. V2_GROUPS in
 * lib/data/v2.ts names which keys each choice shows.
 */
export const PANELS: Record<string, () => Promise<JSX.Element>> = {};
