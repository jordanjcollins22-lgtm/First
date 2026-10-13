import type { OAuthConfigResolver } from "@/lib/integrations/oauth";

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
  /**
   * For OAuth providers: builds the client config from what is saved (see
   * ./oauth.ts). When set, the Integrations page refreshes the token before
   * Test, so a token that expired overnight isn't reported as broken.
   */
  oauthConfig?: OAuthConfigResolver;
  /** Checks the saved values work. Server only. */
  test?: (secrets: Record<string, string>, settings: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string }>;
}
