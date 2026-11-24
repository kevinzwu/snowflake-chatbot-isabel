import { expect, test } from "@playwright/test";

/**
 * Smoke tests — run first as a deployment gate.
 * Tag: @smoke
 *
 * These tests verify the application is alive and responding correctly.
 * If these fail, skip all other test suites.
 */

test.describe("Health Check @smoke", () => {
  test("GET /api/health returns healthy status", async ({ request }) => {
    const startTime = Date.now();
    const response = await request.get("/api/health");
    const elapsed = Date.now() - startTime;

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      status: "healthy",
      service: "isabel",
    });
    expect(body.timestamp).toBeTruthy();

    // Health check should respond quickly
    expect(elapsed).toBeLessThan(5_000);
  });

  test("health endpoint returns correct content-type", async ({ request }) => {
    const response = await request.get("/api/health");
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("application/json");
  });
});

test.describe("Security Headers @smoke", () => {
  test("response includes required security headers", async ({ request }) => {
    const response = await request.get("/api/health");
    const headers = response.headers();

    // Strict-Transport-Security
    expect(headers["strict-transport-security"]).toContain("max-age=");

    // Prevent clickjacking
    expect(headers["x-frame-options"]).toBe("DENY");

    // Prevent MIME sniffing
    expect(headers["x-content-type-options"]).toBe("nosniff");

    // Referrer policy
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("Content-Security-Policy is set", async ({ request }) => {
    const response = await request.get("/api/health");
    const csp = response.headers()["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("Permissions-Policy restricts browser features", async ({ request }) => {
    const response = await request.get("/api/health");
    const policy = response.headers()["permissions-policy"];
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
  });
});

test.describe("Application Reachability @smoke", () => {
  test("main page loads successfully", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
  });

  test("page has correct title or heading", async ({ page }) => {
    await page.goto("/");
    // The app should have identifiable content — verify the main chat input is present
    await expect(page.getByPlaceholder(/ask isabel/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
