import { expect, test } from "../fixtures";

/**
 * Chat sidebar E2E tests.
 */

test.describe("Chat Sidebar", () => {
  test("sidebar is present on the page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/ask isabel/i).waitFor({ timeout: 30_000 });

    // Sidebar may be a nav element or have a sidebar-specific selector
    const sidebar = page.locator('aside, nav, [data-testid="sidebar"]');
    const hasSidebar = await sidebar
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    // Sidebar should be visible on desktop viewports
    expect(hasSidebar).toBe(true);
  });

  test("new conversation button is available", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/ask isabel/i).waitFor({ timeout: 30_000 });

    // Look for a "New Chat" or "+" button
    const newChatButton = page
      .getByRole("button")
      .filter({ hasText: /new|chat|\+/i });

    const hasButton = await newChatButton
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    expect(hasButton).toBe(true);
  });
});
