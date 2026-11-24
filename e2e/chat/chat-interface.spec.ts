import { expect, test } from "../fixtures";

/**
 * Chat interface E2E tests.
 *
 * Tests the main chat page UI elements and interactions.
 * Requires authenticated session.
 */

test.describe("Chat Interface", () => {
  test("main page loads with chat elements", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/ask isabel/i).waitFor({ timeout: 30_000 });

    // Chat input should be visible
    const input = page.getByPlaceholder(/ask isabel/i);
    await expect(input).toBeVisible({ timeout: 15_000 });
  });

  test("empty state shows overview or suggested actions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/ask isabel/i).waitFor({ timeout: 30_000 });

    // Look for overview content or suggested action buttons
    const hasOverview = await page
      .getByText(/welcome to isabel/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    const hasSuggestedActions = await page
      .getByRole("button")
      .filter({ hasText: /vulnerabilit|critical|log4shell/i })
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    expect(hasOverview || hasSuggestedActions).toBe(true);
  });

  test("chat header is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/ask isabel/i).waitFor({ timeout: 30_000 });

    // Header should contain app branding or navigation
    const header = page.locator("header").first();
    await expect(header).toBeVisible({ timeout: 10_000 });
  });
});
