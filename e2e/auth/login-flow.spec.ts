import { expect, test } from "@playwright/test";

/**
 * Authentication flow E2E tests.
 *
 * Tests sign-in redirect behavior and protected route enforcement.
 * Uses unauthenticated browser state to verify access controls.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login Flow", () => {
  test("unauthenticated user visiting / sees sign-in option", async ({
    page,
  }) => {
    await page.goto("/");

    // The app should show a sign-in button or redirect to auth
    const signInButton = page.getByRole("button", { name: /sign in/i });
    const isOnApp = await signInButton
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!isOnApp) {
      // May have been redirected to Azure AD
      const url = page.url();
      const isAuthRedirect =
        url.includes("login.microsoftonline.com") ||
        url.includes("auth/signin");
      expect(isAuthRedirect || isOnApp).toBe(true);
    }
  });

  test("auth/signin page is accessible", async ({ page }) => {
    const response = await page.goto("/auth/signin");
    // NextAuth signin page should load or redirect to provider
    expect(response?.status()).toBeLessThan(500);
  });
});
