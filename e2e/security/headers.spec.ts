import { expect, test } from "@playwright/test";

/**
 * Security headers E2E tests.
 * Tag: @security @smoke
 *
 * Verifies that all security headers from next.config.ts are applied
 * across different routes.
 */

test.describe("Security Headers @security @smoke", () => {
  const routes = ["/api/health"];

  for (const route of routes) {
    test(`${route} has Strict-Transport-Security`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      const hsts = response.headers()["strict-transport-security"];
      expect(hsts).toContain("max-age=31536000");
      expect(hsts).toContain("includeSubDomains");
    });

    test(`${route} has X-Frame-Options: DENY`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.headers()["x-frame-options"]).toBe("DENY");
    });

    test(`${route} has X-Content-Type-Options: nosniff`, async ({
      request,
    }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    });

    test(`${route} has Content-Security-Policy`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      const csp = response.headers()["content-security-policy"];
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
    });
  }
});
