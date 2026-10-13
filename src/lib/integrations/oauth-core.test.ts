import { describe, expect, it } from "vitest";

import {
  buildAuthorizeUrl,
  needsRefresh,
  parseTokenResponse,
  pkceChallenge,
  pkcePair,
  tokenRequest,
  tokenSecrets,
  type OAuthClientConfig,
} from "./oauth-core";

const config: OAuthClientConfig = {
  provider: "quickbooks",
  authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
  tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  clientId: "abc",
  clientSecret: "shh",
  scopes: ["com.intuit.quickbooks.accounting", "openid"],
  redirectUri: "https://app.example.com/api/integrations/quickbooks/callback",
};

describe("pkce", () => {
  it("matches the RFC 7636 example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("makes a verifier of a legal length", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(pkceChallenge(verifier));
  });
});

describe("buildAuthorizeUrl", () => {
  it("carries the client, scopes, state and redirect", () => {
    const url = new URL(buildAuthorizeUrl(config, "s1"));
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting openid");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("code_challenge")).toBeNull();
  });
  it("adds the challenge and extra parameters", () => {
    const url = new URL(
      buildAuthorizeUrl({ ...config, extraAuthorizeParams: { access_type: "offline", prompt: "consent" } }, "s", "ch")
    );
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
});

describe("tokenRequest", () => {
  it("uses HTTP Basic by default", () => {
    const { headers, body } = tokenRequest(config, { grant_type: "refresh_token", refresh_token: "r" });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("abc:shh").toString("base64")}`);
    expect(body.get("client_secret")).toBeNull();
  });
  it("puts the client in the body when asked", () => {
    const { headers, body } = tokenRequest({ ...config, clientAuth: "body" }, { grant_type: "x" });
    expect(headers.Authorization).toBeUndefined();
    expect(body.get("client_id")).toBe("abc");
    expect(body.get("client_secret")).toBe("shh");
  });
});

describe("parseTokenResponse", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("reads Intuit's reply, refresh expiry included", () => {
    const t = parseTokenResponse(
      { access_token: "a", refresh_token: "r", expires_in: 3600, x_refresh_token_expires_in: 8726400, token_type: "bearer" },
      now
    );
    expect(t.expiresAt).toBe("2026-10-13T13:00:00.000Z");
    expect(t.refreshExpiresAt).toBe(new Date(now.getTime() + 8726400 * 1000).toISOString());
    expect(t.refreshToken).toBe("r");
  });
  it("throws with the provider's reason when there is no token", () => {
    expect(() => parseTokenResponse({ error: "invalid_grant", error_description: "Token expired" })).toThrow("Token expired");
  });
});

describe("needsRefresh", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("refreshes in the last minute", () => {
    expect(needsRefresh("2026-10-13T12:00:30Z", now)).toBe(true);
    expect(needsRefresh("2026-10-13T12:05:00Z", now)).toBe(false);
  });
  it("trusts an unknown expiry and refreshes a garbled one", () => {
    expect(needsRefresh(null, now)).toBe(false);
    expect(needsRefresh("nonsense", now)).toBe(true);
  });
});

describe("tokenSecrets", () => {
  it("keeps the old refresh token when a refresh doesn't rotate it", () => {
    const t = parseTokenResponse({ access_token: "a2", expires_in: 3600 });
    expect(tokenSecrets(t, "old").refresh_token).toBe("old");
  });
});
