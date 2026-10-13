/**
 * An outside service the app can be connected to, and what the owner types
 * in to connect it. Each provider lives in its own file under ./providers and
 * is listed in ./registry.ts.
 */
export interface IntegrationField {
  key: string;
  label: string;
  /** Secret fields are write-only: saved, never shown again. */
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  /** Which department it serves, for grouping on the page. */
  area: "Marketing" | "Sales" | "Operations" | "Admin";
  /** One line: what connecting it turns on. */
  enables: string;
  fields: IntegrationField[];
  /** Where the owner gets these values. */
  howTo: string[];
  docsUrl?: string;
  /** If set, a "Connect" button sends the owner here to sign in (OAuth). */
  oauthStartPath?: string;
  /** Checks the saved values work. Server only. */
  test?: (secrets: Record<string, string>, settings: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string }>;
}
