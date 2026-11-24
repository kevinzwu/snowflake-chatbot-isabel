/**
 * MSW request handlers for mocking external APIs during tests.
 */

import { http, HttpResponse } from "msw";

export const TEST_JWKS = {
  keys: [
    {
      kty: "RSA",
      use: "sig",
      kid: "test-key-id",
      n: "test-modulus-base64url",
      e: "AQAB",
      alg: "RS256",
    },
  ],
};

export const handlers = [
  // Mock Azure AD JWKS endpoint
  http.get("https://login.microsoftonline.com/*/discovery/v2.0/keys", () => {
    return HttpResponse.json(TEST_JWKS);
  }),

  // Mock Azure AD OpenID configuration
  http.get(
    "https://login.microsoftonline.com/*/.well-known/openid-configuration",
    () => {
      return HttpResponse.json({
        issuer: "https://login.microsoftonline.com/test-tenant-id/v2.0",
        jwks_uri:
          "https://login.microsoftonline.com/test-tenant-id/discovery/v2.0/keys",
      });
    },
  ),
];
