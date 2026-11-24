import { expect, test } from "../fixtures";

/**
 * Chat input component E2E tests.
 */

test.describe("Chat Input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/ask isabel/i).waitFor({ timeout: 30_000 });
  });

  test("chat input accepts text", async ({ page }) => {
    const input = page.getByPlaceholder(/ask isabel/i);
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill("Show me all critical vulnerabilities");
    await expect(input).toHaveValue("Show me all critical vulnerabilities");
  });

  test("chat input has placeholder text", async ({ page }) => {
    const input = page.getByPlaceholder(/ask isabel/i);
    await expect(input).toBeVisible({ timeout: 15_000 });

    const placeholder = await input.getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
  });

  test("submit button is present", async ({ page }) => {
    // Look for a submit button or send icon
    const submitButton = page
      .getByRole("button")
      .filter({ has: page.locator("svg") })
      .last();

    const hasSubmit = await submitButton
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    // Some implementations use form submission on Enter
    expect(hasSubmit).toBe(true);
  });
});
